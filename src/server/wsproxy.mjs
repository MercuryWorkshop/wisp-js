import * as logging from "../logging.mjs";
import * as filter from "./filter.mjs";
import { stream_types } from "../packet.mjs";
import { AsyncWebSocket, get_conn_id } from "../websocket.mjs";
import { NodeTCPSocket, lookup_ip } from "./net.mjs";

import ipaddr from "ipaddr.js";

const target_regex = /^(\[([\da-f:.]+)\]|[a-z0-9-.]+):(\d+)$/i;

export class WSProxyConnection {
  constructor(ws, path) {
    let destination = path.split("/").pop();
    let match = target_regex.exec(destination);
    if (!match) 
      throw Error("improperly formatted hostname/port");

    this.hostname = (match[2] || match[1]).trim();
    this.port = parseInt(match[3]);
    if (!ipaddr.isValid(this.hostname) && !filter.is_valid_hostname(this.hostname)) {
      throw Error("invalid hostname");
    }
    if (this.port < 1 || this.port >= 2**16) {
      throw Error("out of range port number");
    }

    this.ws = new AsyncWebSocket(ws);
    this.conn_id = get_conn_id();
  }

  async setup() {
    await this.ws.connect();

    //check that the destination host/ip is allowed
    let ip_str = await lookup_ip(this.hostname);
    let err_code = filter.is_stream_allowed(null, stream_types.TCP, this.hostname, this.port, ip_str);
    if (err_code !== 0) {
      logging.info(`(${this.conn_id}) refusing to create a wsproxy connection to ${this.hostname}:${this.port}`);
      this.ws.close();
      throw new filter.AccessDeniedError();
    }

    //connect to the tcp host after we are certain that it's safe to do so
    this.socket = new NodeTCPSocket(this.hostname, this.port);
    await this.socket.connect(ip_str);

    //start the proxy tasks in the background
    this.tcp_to_ws().catch((error) => {
      logging.error(`(${this.conn_id}) a tcp to ws task (wsproxy) encountered an error - ${error}`);
      this.close();
    });
    this.ws_to_tcp().catch((error) => {
      logging.error(`(${this.conn_id}) a ws to tcp task (wsproxy) encountered an error - ${error}`);
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
      await this.ws.send(data);
      this.socket.resume();
    }
    await this.close();
  }

  async ws_to_tcp() {
    while (true) {
      let data = await this.ws.recv();
      if (typeof data === "string") {
        logging.warn(`(${this.conn_id}) routing a packet failed - unexpected ws text frame`);
        continue;
      }
      if (data == null) {
        break; //websocket closed
      }
      await this.socket.send(new Uint8Array(data));
    }
    await this.close();
  }

  async close() {
    this.socket.close();
    this.ws.close();
  }
}