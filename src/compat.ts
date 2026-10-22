//this file contains references to external node modules
//it gets replaced with ./compat_browser.mjs when being bundled for the web

export const global_this = globalThis;

export { WebSocket, WebSocketServer } from "ws";
export * as crypto from "crypto";

export * as http from "node:http";
export * as net from "node:net";
export * as dgram from "node:dgram";
export * as dns from "node:dns/promises";