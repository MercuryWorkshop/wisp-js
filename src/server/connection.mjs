import * as logging from "../logging.mjs";
import * as filter from "./filter.mjs";
import { AsyncQueue, AsyncWebSocket, get_conn_id } from "../websocket.mjs";
import { lookup_ip, NodeTCPSocket, NodeUDPSocket } from "./net.mjs";
import { 
  WispBuffer,
  WispPacket,
  ContinuePayload,
  ClosePayload,
  ConnectPayload,
  DataPayload,
  InfoPayload,
  stream_types,
  close_reasons
} from "../packet.mjs";
import { options } from "./options.mjs";
import { MOTDExtension, UDPExtension, serialize_extensions, parse_extensions } from "../extensions.mjs";

export class HandshakeError extends Error {}

export class ServerStream {
  constructor(conn, stream_id, stream_type, socket) {
    this.conn = conn;
    this.stream_id = stream_id;
    this.stream_type = stream_type;
    this.socket = socket;    
    this.send_buffer = new AsyncQueue(options.send_buffer_size);
    this.packets_sent = 0;
  }

  async setup(ip_str) {
    await this.socket.connect(ip_str);

    //start the proxy tasks in the background
    this.tcp_to_ws().catch((error) => {
      logging.error(`(${this.conn.conn_id}) a tcp/udp to ws task encountered an error - ${error}`);
      this.close();
    });
    this.ws_to_tcp().catch((error) => {
      logging.error(`(${this.conn.conn_id}) a ws to tcp/udp task encountered an error - ${error}`);
      this.close();
    });
  }

  async tcp_to_ws() {
    while (true) {
      let data = await this.socket.recv();
      if (data == null) {
        break;
      }

      this.socket.pause();
      let packet = new WispPacket({
        type: DataPayload.type,
        stream_id: this.stream_id,
        payload: new DataPayload({
          data: new WispBuffer(new Uint8Array(data))
        })
      });
      await this.conn.ws.send(packet);
      this.socket.resume();
    }
    await this.conn.close_stream(this.stream_id, close_reasons.Voluntary);
  }

  async ws_to_tcp() {
    while (true) {
      let data = await this.send_buffer.get();
      if (data == null) {
        break; //stream closed
      }
      await this.socket.send(data);

      this.packets_sent++;
      if (this.stream_type !== stream_types.TCP || this.packets_sent % (options.send_buffer_size / 2) !== 0) {
        continue;
      }
      let packet = new WispPacket({
        type: ContinuePayload.type,
        stream_id: this.stream_id,
        payload: new ContinuePayload({
          buffer_remaining: options.send_buffer_size - this.send_buffer.size
        })
      });
      this.conn.ws.send(packet);
    }
    await this.close();
  }

  async close_buffers() {
    this.send_buffer.close();
    this.socket.close();
  }

  async close(reason) {
    await this.conn.close_stream(this.stream_id, reason);
  }

  async put_data(data) {
    //kill a stream from a misbehaving client that is sending extra data when the buffer is full
    if (this.send_buffer.put_callbacks.length > options.send_buffer_size) {
      await this.close(close_reasons.ConnThrottled);
      return;
    }
    await this.send_buffer.put(data);
  }
}

export class ServerConnection {
  constructor(ws, path, {TCPSocket, UDPSocket, ping_interval, wisp_version, wisp_extensions} = {}) {
    this.ws = new AsyncWebSocket(ws);
    this.path = path;
    this.TCPSocket = TCPSocket || NodeTCPSocket;
    this.UDPSocket = UDPSocket || NodeUDPSocket;
    this.ping_interval = ping_interval || 30;
    this.wisp_version = wisp_version || options.wisp_version;
    this.wisp_extensions = wisp_extensions || null;
    
    this.ping_task = null;
    this.streams = {};
    this.conn_id = get_conn_id();

    this.server_exts = {};
    this.client_exts = {};

    if (this.wisp_version === 2 && this.wisp_extensions === null) {
      this.add_extensions();
    }
  }

  add_extensions() {
    this.wisp_extensions = [];
    if (options.allow_udp_streams) 
      this.wisp_extensions.push(new UDPExtension({server_config: {}}));
    if (options.wisp_motd)
      this.wisp_extensions.push(new MOTDExtension({server_config: {
        message: options.wisp_motd
      }}));
  }

  async setup() {
    logging.info(`setting up new wisp v${this.wisp_version} connection with id ${this.conn_id}`);

    await this.ws.connect();
    if (this.wisp_version == 2) {
      try {
        await this.setup_wisp_v2()
      }
      catch (e) {
        logging.warn(`(${this.conn_id}) error during wisp v2 handshake: ${e}`);
        await this.cleanup();
        throw e;
      }
    }

    //send initial continue packet
    let continue_packet = new WispPacket({
      type: ContinuePayload.type,
      stream_id: 0,
      payload: new ContinuePayload({
        buffer_remaining: options.send_buffer_size
      })
    });
    this.ws.send(continue_packet);

    if (typeof this.ws.ws.ping === "function") {
      this.ping_task = setInterval(() => {
        logging.debug(`(${this.conn_id}) sending websocket ping`);
        this.ws.ws.ping();
      }, this.ping_interval * 1000);  
    }
  }

  async setup_wisp_v2() {
    //send initial info packet for wisp v2
    let ext_buffer = serialize_extensions(this.wisp_extensions);
    let info_packet = new WispPacket({
      type: InfoPayload.type,
      stream_id: 0,
      payload: new InfoPayload({
        major_ver: this.wisp_version,
        minor_ver: 0,
        extensions: ext_buffer
      })
    });
    this.ws.send(info_packet);

    //wait for the client's info packet
    let data = await Promise.race([
      this.ws.recv(),
      new Promise((resolve, reject) => {
        setTimeout(() => reject(new HandshakeError("handshake timed out")), 10000)
      })
    ]);
    if (data == null) {
      throw new HandshakeError(`ws closed before handshake complete`);
    }
    let buffer = new WispBuffer(new Uint8Array(data));
    let packet = WispPacket.parse_all(buffer);

    if (packet.type !== InfoPayload.type) {
      throw new HandshakeError(`unexpected packet of type ${packet.type}`);
    }

    //figure out the common extensions
    let client_extensions = parse_extensions(packet.payload.extensions, this.wisp_extensions, "client");
    for (let client_ext of client_extensions) {
      for (let server_ext of this.wisp_extensions) {
        if (server_ext.id === client_ext.id) {
          this.server_exts[server_ext.id] = server_ext;
          this.client_exts[client_ext.id] = client_ext;
        }
      }
    }
  }

  create_stream(stream_id, type, hostname, port) {
    let SocketImpl = type === stream_types.TCP ? this.TCPSocket : this.UDPSocket;
    let socket = new SocketImpl(hostname, port);
    let stream = new ServerStream(this, stream_id, type, socket);
    this.streams[stream_id] = stream;

    //start connecting to the destination server in the background
    (async () => {
      try {
        let ip_str = await lookup_ip(hostname);
        let close_reason = filter.is_stream_allowed(this, type, hostname, port, ip_str);
        if (close_reason) {
          logging.warn(`(${this.conn_id}) refusing to create a stream to ${hostname}:${port}`);
          await this.close_stream(stream_id, close_reason, true);
          return;
        }
        await stream.setup(ip_str);
      }
      catch (error) {
        logging.warn(`(${this.conn_id}) creating a stream to ${hostname}:${port} failed - ${error}`);
        await this.close_stream(stream_id, close_reasons.NetworkError);
      }
    })();
  }

  async close_stream(stream_id, reason = null, send_packet = true) {
    let stream = this.streams[stream_id];
    if (stream == null)
      return;
    if (reason)
      logging.info(`(${this.conn_id}) closing stream to ${stream.socket.hostname} for reason ${reason}`);

    delete this.streams[stream_id];
    await stream.close_buffers();
    if (reason && send_packet)
      await this.send_close_packet(stream_id, reason);
  }

  route_packet(buffer) {
    let packet = WispPacket.parse_all(buffer);
    let stream = this.streams[packet.stream_id];

    if (packet.stream_id === 0) {
      logging.warn(`(${this.conn_id}) recieved packet with stream ID 0 after handshake`)
      return;
    }

    if (stream == null && packet.type == DataPayload.type) {
      logging.warn(`(${this.conn_id}) received a DATA packet for a stream which doesn't exist`);
      return;
    }

    if (packet.type === ConnectPayload.type) {
      if (stream) {
        logging.warn(`(${this.conn_id}) received a CONNECT packet for a stream which already exists`);
        return;
      }

      let stream_type = packet.payload.stream_type;
      if (stream_type != stream_types.TCP && stream_type != stream_types.UDP) {
        logging.warn(`(${this.conn_id}) received a CONNECT packet with an invalid stream ID`);
        this.send_close_packet(packet.stream_id, close_reasons.InvalidInfo);
        return;
      }

      let type_info = stream_type === stream_types.TCP ? "TCP" : "UDP";
      logging.info(`(${this.conn_id}) opening new ${type_info} stream to ${packet.payload.hostname}:${packet.payload.port}`);
      this.create_stream(
        packet.stream_id, 
        packet.payload.stream_type, 
        packet.payload.hostname.trim(), 
        packet.payload.port
      )
    }

    else if (packet.type === DataPayload.type) {
      stream.put_data(packet.payload.data.bytes);
    }

    else if (packet.type == ContinuePayload.type) {
      logging.warn(`(${this.conn_id}) client sent a CONTINUE packet, this should never be possible`);
    }

    else if (packet.type == ClosePayload.type) {
      this.close_stream(packet.stream_id, packet.payload.reason, false);
    }
  }

  async send_close_packet(stream_id, reason) {
    let packet = new WispPacket({
      type: ClosePayload.type,
      stream_id: stream_id,
      payload: new ClosePayload({
        reason: reason || 0x01
      })
    });
    await this.ws.send(packet);
  }

  async run() {
    while (true) {
      let data;
      data = await this.ws.recv();
      if (data == null) {
        break; //websocket closed
      }
      if (typeof data === "string") {
        logging.warn(`(${this.conn_id}) routing a packet failed - unexpected ws text frame`);
        continue;
      }
      
      try {
        //note: data is an arraybuffer so the uint8array constructor does not copy
        this.route_packet(new WispBuffer(new Uint8Array(data)));
      }
      catch (error) {
        logging.warn(`(${this.conn_id}) routing a packet failed - ${error}`);
      }
    }
    
    await this.cleanup();
  }

  async cleanup() {
    //clean up all streams when the websocket is closed
    for (let stream_id of Object.keys(this.streams)) {
      await this.close_stream(stream_id);
    }
    clearInterval(this.ping_task);
    logging.info(`(${this.conn_id}) wisp connection closed`);
    this.ws.close();
  }
}