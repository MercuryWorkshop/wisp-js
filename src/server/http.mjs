import * as logging from "../logging.mjs";
import * as compat from "../compat.mjs";

import { options } from "./options.mjs";
import { AccessDeniedError } from "./filter.mjs";
import { ServerConnection, HandshakeError } from "./connection.mjs";
import { WSProxyConnection } from "./wsproxy.mjs";
import { is_node, assert_on_node } from "./net.mjs";

let ws_server = null;
if (is_node) {
  ws_server = new compat.WebSocketServer({ noServer: true });
}

export function parse_real_ip(headers, client_ip) {
  if (options.parse_real_ip && options.parse_real_ip_from.includes(client_ip)) {
    if (headers["x-forwarded-for"]) {
      return headers["x-forwarded-for"].split(",")[0].trim();
    }
    else if (headers["x-real-ip"]) {
      return headers["x-real-ip"];
    }
  }
  return client_ip;
}

export function routeRequest(request, socket, head, conn_options={}) {
  assert_on_node();
  if (request.headers["sec-websocket-protocol"] && options.wisp_version === 2)
    conn_options.wisp_version = 2;
  else 
    conn_options.wisp_version = 1;

  if (request instanceof compat.http.IncomingMessage) {
    ws_server.handleUpgrade(request, socket, head, (ws) => {
      create_connection(ws, request.url, request, conn_options);
    });
  }
  else if (request instanceof compat.WebSocket) {
    create_connection(ws, "/", {}), conn_options;
  }
}

async function create_connection(ws, path, request, conn_options) {
  ws.binaryType = "arraybuffer";
  let client_ip = request.socket.address().address;
  let real_ip = parse_real_ip(request.headers, client_ip);
  let origin = request.headers["origin"];
  logging.info(`new connection on ${path} from ${real_ip} (origin: ${origin})`);
  
  try {
    if (path.endsWith("/")) {
      let wisp_conn = new ServerConnection(ws, path, conn_options);
      await wisp_conn.setup();
      await wisp_conn.run();
    }
  
    else {
      let wsproxy = new WSProxyConnection(ws, path, conn_options);
      await wsproxy.setup();
    }
  }

  catch (error) {
    ws.close();
    if (error instanceof HandshakeError) return;
    if (error instanceof AccessDeniedError) return;
    logging.error("Uncaught server error:\n" + (error.stack || error));
  }
}