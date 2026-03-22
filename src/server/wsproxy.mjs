import * as logging from "../logging.mjs";
import * as filter from "./filter.mjs";
import { stream_types } from "../packet.mjs";
import { AsyncWebSocket } from "../websocket.mjs";
import { NodeTCPSocket } from "./net.mjs";

export class WSProxyConnection {
  constructor(ws, path) {
    let [hostname, port] = path.split("/").pop().split(":");
    this.hostname = hostname.trim();
    this.port = parseInt(port);
    this.ws = new AsyncWebSocket(ws);
    this.closed = false;
  }

  async cleanup() {
    if (this.closed) return;
    this.closed = true;
    if (this.socket) await this.socket.close();
    this.ws.close();
  }

  async setup() {
    await this.ws.connect();

    //check that the destination host/ip is allowed
    let err_code = await filter.is_stream_allowed(null, stream_types.TCP, this.hostname, this.port);
    if (err_code !== 0) {
      logging.info(`Refusing to create a wsproxy connection to ${this.hostname}:${this.port}`);
      this.ws.close();
      throw new filter.AccessDeniedError();
    }

    //connect to the tcp host after we are certain that it's safe to do so
    this.socket = new NodeTCPSocket(this.hostname, this.port);
    await this.socket.connect();

    //start the proxy tasks in the background
    this.tcp_to_ws().catch((error) => {
      logging.error(`a tcp to ws task (wsproxy) encountered an error - ${error}`);
      this.cleanup();
    });
    this.ws_to_tcp().catch((error) => {
      logging.error(`a ws to tcp task (wsproxy) encountered an error - ${error}`);
      this.cleanup();
    });
  }

  async tcp_to_ws() {
    while (true) {
      let data = await this.socket.recv();
      if (data == null) {
        break;
      }
      this.socket.pause();
      await this.ws.send(data);
      this.socket.resume();
    }
    await this.cleanup();
  }

  async ws_to_tcp() {
    while (true) {
      let data;
      data = await this.ws.recv();
      if (data == null) {
        break; //websocket closed
      }
      await this.socket.send(data);
    }
    await this.cleanup();
  }
}