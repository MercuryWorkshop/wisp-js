import { global_this } from "../compat.mjs";
import { ClientConnection } from "./connection.mjs";
import { close_reasons } from "../packet.mjs";

//polyfill the DOM Websocket API so that applications using wsproxy can easily use wisp with minimal changes

const RealCloseEvent = (global_this.CloseEvent || Event);
export const _wisp_connections = {};

export class WispWebSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1
  static CLOSING = 2;
  static CLOSED = 3;
  constructor(url, protocols=null, options = {}) {
    super();
    this.url = url;
    this.protocols = protocols;
    this.options = options;
    this.binaryType = "blob";
    this.stream = null;
    this.connection = null;

    //legacy event handlers
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    
    this.CONNECTING = WispWebSocket.CONNECTING;
    this.OPEN = WispWebSocket.OPEN;
    this.CLOSING = WispWebSocket.CLOSING;
    this.CLOSED = WispWebSocket.CLOSED;
    this._ready_state = this.CONNECTING;

    //parse the wsproxy url
    let url_split = this.url.split("/");
    let wsproxy_path = url_split.pop().split(":");
    this.host = wsproxy_path[0];
    this.port = parseInt(wsproxy_path[1]);
    this.real_url = url_split.join("/") + "/";

    this.init_connection();
  }

  fake_event_send(event) {
    this["on" + event.type]?.(event);
    this.dispatchEvent(event);
	};

  init_connection() {
    //create the stream
    this.connection = _wisp_connections[this.real_url];

    if (!this.connection) {
      this.connection = new ClientConnection(this.real_url, this.options);
      this.connection.onopen = () => {
        this.init_stream();
      };
      this.connection.onclose = () => {
        this.on_conn_close(false)
      };
      this.connection.onerror = () => {
        this.on_conn_close(true)
      };
      _wisp_connections[this.real_url] = this.connection;
    }
    else if (!this.connection.connected) {
      let old_onopen = this.connection.onopen;
      let old_onclose = this.connection.onclose;
      let old_onerror = this.connection.onerror;
      this.connection.onopen = () => {
        old_onopen();
        this.init_stream();
      };
      this.connection.onclose = () => {
        old_onclose();
        this.on_conn_close(false);
      };
      this.connection.onerror = () => {
        old_onerror();
        this.on_conn_close(true);
      };
    }
    else {
      this.connection = _wisp_connections[this.real_url];
      this.init_stream();
    }
  }

  on_conn_close(is_error = false) {
    if (this._ready_state === this.CLOSED) 
      return;
    this._ready_state = this.CLOSED;

    if (is_error) 
      this.fake_event_send(new Event("error"));
    this.fake_event_send(new RealCloseEvent("close", {code: 1000}));
    delete _wisp_connections[this.real_url];
  }

  init_stream() {
    if (this._ready_state === this.CLOSED) {
      return;
    }
    this._ready_state = this.OPEN;
    this.stream = this.connection.create_stream(this.host, this.port);

    this.stream.onmessage = (raw_data) => {
      let data;
      if (this.binaryType == "blob") {
        data = new Blob([raw_data]);
      }
      else if (this.binaryType == "arraybuffer") {
        data = raw_data.slice().buffer;
      }
      else {
        throw new TypeError("invalid binaryType string");
      }
      this.fake_event_send(new MessageEvent("message", {data: data}));
    };

    this.stream.onclose = (reason) => {
      if (this._ready_state === this.CLOSED) 
        return;
      this._ready_state = this.CLOSED;
      if (reason !== close_reasons.Voluntary) 
        this.fake_event_send(new Event("error"));
      this.fake_event_send(new RealCloseEvent("close", {code: reason}));
    };

    this.fake_event_send(new Event("open"));
  }

  send(data) {
    let data_array;

    if (data instanceof Uint8Array) {
      data_array = data;  
    }
    else if (typeof data === "string") {
      data_array = new TextEncoder().encode(data);
    }
    else if (data instanceof Blob) {
      data.arrayBuffer().then(array_buffer => {
        this.send(array_buffer);
      });
      return;
    }
    else if (data instanceof ArrayBuffer) {
      data_array = new Uint8Array(data);
    }
    //dataview objects or any other typedarray
    else if (ArrayBuffer.isView(data)) {
      data_array = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    else {
      throw new TypeError("invalid data type to be sent");
    }

    if (!this.stream) {
      throw new TypeError("websocket is not ready");
    }
    this.stream.send(data_array);
  }

  close() {
    if (!this.stream) {
      if (this._ready_state === this.CLOSED) 
        return;
      this._ready_state = this.CLOSED;
      this.fake_event_send(new RealCloseEvent("close", {code: 1000}));
      return;
    }
    this.stream.close(close_reasons.Voluntary);
  }

  get bufferedAmount() {
    if (!this.stream) return 0;
    let total = 0;
    for (const msg of this.stream.send_buffer) {
      total += msg.length;
    }
    return total;
  }

  get extensions() {
    return "";
  }

  get protocol() {
    return "binary";
  }

  get readyState() {
    return this._ready_state;
  }
}