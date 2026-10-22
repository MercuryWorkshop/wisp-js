//async websocket wrapper for both node and the browser

import type { WebSocket as NodeWebSocket } from "ws";
import * as compat from "./compat";
import { WispPacket } from "./packet";

export function get_conn_id(): string {
  return compat.crypto.randomUUID().split("-")[0];
}

export type AnyWebSocket = WebSocket | NodeWebSocket;
export type WebSocketData = string | ArrayBuffer;
export type WebSocketSendable = string | ArrayBuffer | ArrayBufferView | Blob;

//an async websocket wrapper
export class AsyncWebSocket {
  send_buffer_size = 32*1024*1024;
  ws: AnyWebSocket;
  connected: boolean;
  data_queue: AsyncQueue<WebSocketData>;

  constructor(ws: AnyWebSocket) {
    this.ws = ws;
    this.connected = false;
    this.data_queue = new AsyncQueue(1);
  }

  async connect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.ws.onopen = () => {
        this.connected = true;
        resolve();
      }
      this.ws.onmessage = (event: { data: unknown }) => {
        this.data_queue.put(event.data as WebSocketData);
      }
      this.ws.onclose = () => {
        if (!this.connected) reject();
        else this.data_queue.close();
      }
      if (this.ws.readyState === this.ws.OPEN) {
        this.connected = true;
        resolve();
      }
    });
  }

  async recv(): Promise<WebSocketData | undefined> {
    return await this.data_queue.get();
  }

  async send(data: WispPacket | WebSocketSendable): Promise<void> {
    if (data instanceof WispPacket) {
      data = data.serialize().bytes
    }

    this.ws.send(data as WebSocketData);
    if (this.ws.bufferedAmount <= this.send_buffer_size) {
      return;
    }

    //if the send buffer is too full, throttle the upload
    while (true) {
      if (this.ws.bufferedAmount <= this.send_buffer_size / 2) {
        break;
      }
      await new Promise<void>((resolve) => {setTimeout(resolve, 10)});
    }
  }

  close(code?: number, reason?: string): void {
    this.ws.close(code, reason);
    this.data_queue.close();
  }

  get buffered_amount(): number {
    return this.ws.bufferedAmount;
  }
}

//an async fifo queue
export class AsyncQueue<T> {
  max_size: number;
  queue: T[];
  put_callbacks: (() => void)[];
  get_callbacks: (() => void)[];

  constructor(max_size: number) {
    this.max_size = max_size;
    this.queue = [];
    this.put_callbacks = [];
    this.get_callbacks = [];
  }

  put_now(data: T): void {
    this.queue.push(data);
    this.get_callbacks.shift()?.();
  }

  async put(data: T): Promise<void> {
    if (this.size <= this.max_size) {
      this.put_now(data);
      return;
    }

    //wait until there is a place to put the item
    await new Promise<void>((resolve) => {
      this.put_callbacks.push(resolve);
    });
    this.put_now(data);
  }

  //returns undefined if the queue is empty or was closed
  get_now(): T | undefined {
    this.put_callbacks.shift()?.();
    return this.queue.shift();
  }

  async get(): Promise<T | undefined> {
    if (this.size > 0) {
      return this.get_now();
    }

    //wait until there is an item available in the queue
    await new Promise<void>((resolve) => {
      this.get_callbacks.push(resolve);
    });
    return this.get_now();
  }

  close(): void {
    this.queue = [];
    let callback: (() => void) | undefined;
    //resolve all pending operations
    while (callback = this.get_callbacks.shift())
      callback();
    while (callback = this.put_callbacks.shift())
      callback();
  }

  get size(): number {
    return this.queue.length;
  }
}
