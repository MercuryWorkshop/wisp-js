import { client as wisp } from "@mercuryworkshop/wisp-js/client";

let ws_url = `ws://localhost:5001/ws/`;

let conn = new wisp.ClientConnection(ws_url, {wisp_version: 2});

conn.onopen = () => {
  console.log("wisp version:", conn.wisp_version);
  console.log("udp enabled:", conn.udp_enabled);
  console.log("motd:", conn.server_motd);

  let stream = conn.create_stream("cloudflare.com", 80);

  stream.onmessage = (data) => {
    let text = new TextDecoder().decode(data);
    console.log("message from stream 1: ", text);
  }
  stream.onclose = () => {
    conn.close();
  }

  let payload = "GET /cdn-cgi/trace HTTP/1.1\r\nHost: cloudflare.com\r\nConnection: close\r\n\r\n";
  stream.send(new TextEncoder().encode(payload));
}

conn.onclose = () => {
  console.log("stream 1 closed");
}
