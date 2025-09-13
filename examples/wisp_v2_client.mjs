import { client as wisp } from "@mercuryworkshop/wisp-js/client";

let ws_url = `ws://localhost:5001/ws/`;
let ws = new wisp.WispWebSocket(ws_url + "cloudflare.com:80", null, {wisp_version: 2});

ws.binaryType = "arraybuffer";
ws.addEventListener("open", () => {
  let payload = "GET /cdn-cgi/trace HTTP/1.1\r\nHost: cloudflare.com\r\nConnection: keepalive\r\n\r\n";
  ws.send(payload);
});
ws.addEventListener("message", (event) => {
  let text = new TextDecoder().decode(event.data);
  console.log(`message from stream 1: `, text);
});
ws.addEventListener("close", () => {
  console.log("stream 1 closed");
});
