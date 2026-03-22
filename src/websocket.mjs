//async websocket wrapper for both node and the browser

import * as compat from "./compat.mjs";
import { WispPacket } from "./packet.mjs";

export function get_conn_id() {
  return compat.crypto.randomUUID().split("-")[0];
}

//an async websocket wrapper
export class AsyncWebSocket {
  send_buffer_size = 32*1024*1024;
  
  constructor(ws) {
    this.ws = ws;
    this.connected = false;
    this.data_queue = new AsyncQueue(1);
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.ws.onopen = () => {
        this.connected = true;
        resolve();
      }
      this.ws.onmessage = (event) => {
        this.data_queue.put(event.data);
      }
      this.ws.onclose = () => {
        if (!this.connected) reject(new Error("WebSocket closed before connection established"));
        else this.data_queue.close();
      }
      this.ws.onerror = (error) => {
        if (!this.connected) reject(error);
      }
      if (this.ws.readyState === this.ws.OPEN) {
        this.connected = true;
        resolve();
      }
    });
  }

  async recv() {
    return await this.data_queue.get();
  }

  async send(data) {
    if (data instanceof WispPacket) {
      data = data.serialize().bytes
    }

    this.ws.send(data);
    if (this.ws.bufferedAmount <= this.send_buffer_size) {
      return;
    }

    //if the send buffer is too full, throttle the upload
    while (true) {
      if (this.ws.bufferedAmount <= this.send_buffer_size / 2) {
        break;
      }
      await new Promise((resolve) => {setTimeout(resolve, 10)});
    }
  }

  close(code, reason) {
    this.ws.close(code, reason);
    this.data_queue.close();
  }

  get buffered_amount() {
    return this.ws.bufferedAmount;
  }
}

//an async fifo queue
export class AsyncQueue {
  constructor(max_size) {
    this.max_size = max_size;
    this.queue = [];
    this.put_callbacks = [];
    this.get_callbacks = [];
  }

  put_now(data) {
    this.queue.push(data);
    this.get_callbacks.shift()?.();
  }

  async put(data) {
    if (this.size <= this.max_size) {
      this.put_now(data);
      return;
    }

    //wait until there is a place to put the item
    await new Promise((resolve) => {
      this.put_callbacks.push(resolve);
    });
    this.put_now(data);
  }

  get_now() {
    this.put_callbacks.shift()?.();
    return this.queue.shift();
  }

  async get() {
    if (this.size > 0) {
      return this.get_now();
    }

    //wait until there is an item available in the queue
    await new Promise((resolve) => {
      this.get_callbacks.push(resolve);
    });
    return this.get_now();
  }

  close() {
    this.queue = [];
    let callback;
    //resolve all pending operations
    while (callback = this.get_callbacks.shift())
      callback();
    while (callback = this.put_callbacks.shift())
      callback();
  }

  get size() {
    return this.queue.length;
  }
}