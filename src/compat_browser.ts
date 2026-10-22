//the node modules referenced by other parts of the code do not exist on the web
//some of them can be replaced by the standard browser apis, others have to be ignored

//compatibility for old browsers where globalThis doesn't exist
export const global_this = typeof globalThis === "undefined" ? window : globalThis;

export const WebSocket = global_this.WebSocket;
export const WebSocketServer = null;
export const crypto = global_this.crypto;

export const http = null;
export const net = null;
export const dgram = null;
export const dns = null;