import * as compat from "../compat.mjs";

import {
  packet_classes,
  packet_types,
  stream_types,
  WispBuffer, 
  WispPacket, 
  ConnectPayload, 
  DataPayload, 
  ClosePayload,
  InfoPayload
} from "../packet.mjs";

import { MOTDExtension, UDPExtension, serialize_extensions, parse_extensions } from "../extensions.mjs";

class ClientStream {
  constructor(hostname, port, websocket, buffer_size, stream_id, connection, stream_type) {
    this.hostname = hostname;
    this.port = port;
    this.ws = websocket;
    this.buffer_size = buffer_size;
    this.stream_id = stream_id;
    this.connection = connection;
    this.stream_type = stream_type;
    this.send_buffer = [];
    this.open = true;

    this.onopen = () => {};
    this.onclose = () => {};
    this.onmessage = () => {};
  }

  send(data) {
    //note: udp shouldn't buffer anything
    if (this.buffer_size > 0 || !this.open || this.stream_type === stream_types.UDP) {
      //construct and send a DATA packet
      let packet = new WispPacket({
        type: packet_types.DATA,
        stream_id: this.stream_id,
        payload: new DataPayload({
          data: new WispBuffer(data)
        })
      });
      this.ws.send(packet.serialize().bytes);
      this.buffer_size--;
    }
    else { //server is slow, don't send data yet
      this.send_buffer.push(data);
    }
  }

  //handle receiving a CONTINUE packet
  continue_received(buffer_size) {
    this.buffer_size = buffer_size;
    //send buffered data now
    while (this.buffer_size > 0 && this.send_buffer.length > 0) {
      this.send(this.send_buffer.shift());
    }
  }

  //construct and send a CLOSE packet
  close(reason = 0x01) {
    if (!this.open) return;
    let packet = new WispPacket({
      type: packet_types.CLOSE,
      stream_id: this.stream_id,
      payload: new ClosePayload({
        reason: reason
      })
    });
    this.ws.send(packet.serialize().bytes);
    this.open = false;
    delete this.connection.active_streams[this.stream_id];
  }
}

export class ClientConnection {
  constructor(wisp_url, {wisp_version, wisp_extensions} = {}) {
    if (!wisp_url.endsWith("/")) {
      throw new TypeError("wisp endpoints must end with a trailing forward slash");
    }

    this.wisp_url = wisp_url;
    this.wisp_version = wisp_version || 2;
    this.wisp_extensions = wisp_extensions || null;

    this.max_buffer_size = null;
    this.active_streams = {};
    this.connected = false;
    this.connecting = false;
    this.next_stream_id = 1;

    this.server_exts = {};
    this.client_exts = {};
    this.info_received = false;
    this.server_motd = null;
    this.udp_enabled = true;

    this.onopen = () => {};
    this.onclose = () => {};
    this.onerror = () => {};
    this.onmessage = () => {};

    if (this.wisp_version === 2 && this.wisp_extensions === null) {
      this.add_extensions();
    }

    this.connect_ws();
  }

  add_extensions() {
    this.wisp_extensions = [];
    this.wisp_extensions.push(new UDPExtension({client_config: {}}));
    this.wisp_extensions.push(new MOTDExtension({client_config: {}}));
  }

  connect_ws() {
    let subprotocol = this.wisp_version === 2 ? "wisp-v2" : undefined;
    this.ws = new compat.WebSocket(this.wisp_url, subprotocol);
    this.ws.binaryType = "arraybuffer";
    this.connecting = true;

    this.ws.onerror = () => {
      this.on_ws_close();
      this.onerror();
    };
    this.ws.onclose = () => {
      this.on_ws_close();
      this.onclose();
    };
    this.ws.onmessage = (event) => {
      this.on_ws_msg(event);
      if (this.connected && this.connecting) {
        this.connecting = false;
        this.onopen();
      }
    };
  }

  close() {
    this.ws.close();
  }

  close_stream(stream, reason) {
    stream.onclose(reason);
    delete this.active_streams[stream.stream_id];
  }

  on_ws_close() {
    this.connected = false;
    this.connecting = false;
    for (let stream_id of Object.keys(this.active_streams)) {
      this.close_stream(this.active_streams[stream_id], 0x03);
    }
  }

  create_stream(hostname, port, type=0x01) {
    let stream_type = type;
    if (typeof stream_type === "string") 
      stream_type = type === "udp" ? stream_types.UDP : stream_types.TCP;

    if (stream_type == stream_types.UDP && !this.udp_enabled) {
      throw new Error("udp is not enabled for this wisp connection");
    }

    let stream_id = this.next_stream_id++;
    let stream = new ClientStream(hostname, port, this.ws, this.max_buffer_size, stream_id, this, stream_type);
    this.active_streams[stream_id] = stream;
    stream.open = this.connected;

    //construct CONNECT packet
    let packet = new WispPacket({
      type: packet_types.CONNECT,
      stream_id: stream_id,
      payload: new ConnectPayload({
        stream_type: stream_type,
        port: port,
        hostname: hostname
      })
    });
    this.ws.send(packet.serialize().bytes);
    return stream;
  }

  on_ws_msg(event) {
    let buffer = new WispBuffer(new Uint8Array(event.data));
    if (buffer.size < WispPacket.min_size) {
      console.warn(`wisp client warning: received a packet which is too short`);
      return;
    }
    let packet = WispPacket.parse_all(buffer);
    let stream = this.active_streams[packet.stream_id];

    if (packet.stream_id === 0 && this.connecting) {
      if (packet.type === packet_types.CONTINUE) {
        this.max_buffer_size = packet.payload.buffer_remaining;
        this.connected = true;
        if (!this.info_received) {
          this.wisp_version = 1;
        }
      }
      
      if (packet.type === packet_types.INFO && this.wisp_version === 2) {
        let server_extensions = parse_extensions(packet.payload.extensions, this.wisp_extensions, "server");
        for (let server_ext of server_extensions) {
          for (let client_ext of this.wisp_extensions) {
            if (server_ext.id === client_ext.id) {
              this.server_exts[server_ext.id] = server_ext;
              this.client_exts[client_ext.id] = client_ext;
            }
          }
        }

        this.info_received = true; 
        this.server_motd = this.server_exts[MOTDExtension.id]?.payload?.message;
        this.udp_enabled = !!this.server_exts[UDPExtension.id];

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
        this.ws.send(info_packet.serialize().bytes);
      }
      return;
    }

    if (typeof stream === "undefined") {
      console.warn(`wisp client warning: received a ${packet_classes[packet.type].name} packet for a stream which doesn't exist`);
      return;
    }

    if (packet.type === packet_types.DATA) {
      stream.onmessage(packet.payload_bytes.bytes);
    }

    else if (packet.type === packet_types.CONTINUE) { //other CONTINUE packets
      stream.continue_received(packet.payload.buffer_remaining);
    }

    else if (packet.type === packet_types.CLOSE) {
      this.close_stream(stream, packet.payload.reason);
    }

    else {
      console.warn(`wisp client warning: received an invalid packet of type ${packet.type}`);
    }
  }
}

