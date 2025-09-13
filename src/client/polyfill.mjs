import { global_this } from "../compat.mjs";
import { ClientConnection } from "./connection.mjs";

//polyfill the DOM Websocket API so that applications using wsproxy can easily use wisp with minimal changes

const RealCloseEvent = (global_this.CloseEvent || Event);
export const _wisp_connections = {};

export class WispWebSocket extends EventTarget {
  constructor(url, protocols=null, options = {}) {
    super();
    this.url = url;
    this.protocols = protocols;
    this.options = options;
    this.binaryType = "blob";
    this.stream = null;
    this.connection = null;

    //legacy event handlers
    this.onopen = () => {};
    this.onerror = () => {};
    this.onmessage = () => {};
    this.onclose = () => {};

    this.CONNECTING = 0;
    this.OPEN = 1;
    this.CLOSING = 2;
    this.CLOSED = 3;
    this._ready_state = this.CONNECTING;

    //parse the wsproxy url
    let url_split = this.url.split("/");
    let wsproxy_path = url_split.pop().split(":");
    this.host = wsproxy_path[0];
    this.port = parseInt(wsproxy_path[1]);
    this.real_url = url_split.join("/") + "/";

    this.init_connection();
  }

  on_conn_close() {
    this._ready_state = this.CLOSED;
    if (_wisp_connections[this.real_url]) {
      this.onerror(new Event("error"));
      this.dispatchEvent(new Event("error"));
    }
    delete _wisp_connections[this.real_url];
  }

  init_connection() {
    //create the stream
    this.connection = _wisp_connections[this.real_url];

    if (!this.connection) {
      this.connection = new ClientConnection(this.real_url, this.options);
      this.connection.onopen = () => {
        this.init_stream();
      };
      this.connection.onclose = () => {
        this.on_conn_close()
      };
      this.connection.onerror = () => {
        this.on_conn_close()
      };
      _wisp_connections[this.real_url] = this.connection;
    }
    else if (!this.connection.connected) {
      let old_onopen = this.connection.onopen;
      this.connection.onopen = () => {
        old_onopen();
        this.init_stream();
      };
    }
    else {
      this.connection = _wisp_connections[this.real_url];
      this.init_stream();
    }
  }

  init_stream() {
    this._ready_state = this.OPEN;
    this.stream = this.connection.create_stream(this.host, this.port);

    this.stream.onmessage = (raw_data) => {
      let data;
      if (this.binaryType == "blob") {
        data = new Blob(raw_data);
      }
      else if (this.binaryType == "arraybuffer") {
        data = raw_data.buffer;
      }
      else {
        throw "invalid binaryType string";
      }
      let msg_event = new MessageEvent("message", {data: data});
      this.onmessage(msg_event);
      this.dispatchEvent(msg_event);
    };

    this.stream.onclose = (reason) => {
      this._ready_state = this.CLOSED;
      let close_event = new RealCloseEvent("close", {code: reason}); 
      this.onclose(close_event);
      this.dispatchEvent(close_event);
    };

    let open_event = new Event("open");
    this.onopen(open_event);
    this.dispatchEvent(open_event);
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
      data_array = new Uint8Array(data.buffer);
    }
    else {
      throw "invalid data type to be sent";
    }

    if (!this.stream) {
      throw "websocket is not ready";
    }
    this.stream.send(data_array);
  }

  close() {
    this.stream.close(0x02);
  }

  get bufferedAmount() {
    let total = 0;
    for (let msg of this.stream.send_buffer) {
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