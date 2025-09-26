# JavaScript Wisp Implementation

This is an implementation of a [Wisp](https://github.com/mercuryWorkshop/wisp-protocol) client and server, written in Javascript for use in NodeJS and in the browser.

## Features:
- Complete Wisp client and server implementations
- Supports Wisp v2 and v1
- APIs available for client and server
- Highly configurable 
- Supports NodeJS and the browser

### Library Entrypoints:
- `@mercuryworkshop/wisp-js/client` - Only contains the client code.
- `@mercuryworkshop/wisp-js/server` - Contains the server code, and the logging module.
- `@mercuryworkshop/wisp-js` - Contains the server, client, and logging code.

All of these entrypoints support being imported as either a CommonJS or ES6 module.

## Server CLI:
THere is a CLI interface available for the Wisp server, and it can be used by running:
```
$ npm i @mercuryworkshop/wisp-js
added 6 packages in 2s
$ npx wisp-js-server --help
Usage: wisp-js-server [options]

A Wisp server implementation written in Javascript. (v0.4.0)

Options:
  -V, --version                 output the version number
  -H, --host <host>             The hostname the server will listen on. (default: "127.0.0.1")
  -P, --port <port>             The port number to run the server on. (default: 5001)
  -L, --logging <log_level>     The log level to use. This is either DEBUG, INFO, WARN, ERROR, or NONE.
                                (default: "INFO")
  -S, --static <static_dir>     The directory to serve static files from. (optional)
  -C, --config <config_path>    The path to your Wisp server config file. This is the same format as
                                `wisp.options` in the API. (optional)
  -O, --options <options_json>  A JSON string to set the Wisp config without using a file. (optional)
  -h, --help                    display help for command
```
You may also clone this repository and run `npm run server_cli -- --help`.

The config file is a JSON file with the same entries as the [global server config](https://github.com/MercuryWorkshop/wisp-client-js/?tab=readme-ov-file#changing-server-settings) in the API.

## Client API:

### Importing the Client Library:
To use the library as an ES6 module, either in Node or using a bundler for the browser, include the following import:
```js
import { client as wisp } from "@mercuryworkshop/wisp-js/client";
```

To use it in Node with CommonJS:
```js
const { client: wisp } = require("@mercuryworkshop/wisp-js/client");
```

If you are not using a bundler, you may import the files in the dist folder of the package. The `wisp-client.mjs` file is an ES6 module that has the same entrypoint as the example above. The `wisp-client.js` file is a regular JS file that produce a global variable named `wisp_client`, which contains all of the exported modules. 

### Connecting to a Wisp Server:
You can create a new Wisp connection by creating a new `ClientConnection` object. The only argument to the constructor is the URL of the Wisp websocket server. Use the `open` event to know when the Wisp connection is ready.
```js
import { client as wisp } from "@mercuryworkshop/wisp-js/client";

let conn = new wisp.ClientConnection("wss://example.com/wisp/");
conn.onopen = () => {
  console.log("wisp connection is ready!");
};
conn.onclose = () => {
  console.log("wisp connection closed");
};
conn.onerror = () => {
  console.log("wisp connection error");
};
```

You can close the Wisp connection with `conn.close()`.

### Creating New Streams:
Once you have your `WispConnection` object, and you have waited for the connection to be established, you can use the `WispConnection.create_stream` method to create new streams. The two arguments to this function are the hostname and port of the new stream, and a `WispStream` object will be returned. You can also pass a third argument to `create_stream`, which is the type of the stream, and it can be either `"tcp"` (the default) or `"udp"`.

For receiving incoming messages, use the `onmessage` callback on the `WispStream` object. The returned data will always be a `Uint8Array`. The `onclose` callback can be used to know when the stream is closed. 

You can use `stream.send` to send data to the stream, and it must take a `Uint8Array` as the argument. Newly created streams are available for writing immediately, so you don't have to worry about waiting to send your data.
```js
let stream = conn.create_stream("www.google.com", 80);
stream.onmessage = (data) => {
  let text = new TextDecoder().decode(data);
  console.log(text);
};
stream.onclose = (reason) => {
  console.log("stream closed for reason: " + reason);
};

let payload = "GET / HTTP/1.1\r\nHost: www.google.com\r\nConnection: close\r\n\r\n";
stream.send(new TextEncoder().encode(payload));
```

### Using the WebSocket Polyfill:
The `polyfill.js` file provides an API similar to the regular [DOM WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket). Instead of creating new `WebSocket` objects, create `WispWebSocket` objects. Make sure the URL ends with the hostname and port you want to connect to. If you have code that uses the older wsproxy protocol, you can use this polyfill to provide Wisp support easily.
```js
import { client as wisp } from "@mercuryworkshop/wisp-js/client";

let ws = new wisp.WispWebSocket("wss://example.com/ws/alicesworld.tech:80");
ws.binaryType = "arraybuffer";
ws.addEventListener("open", () => {
  let payload = "GET / HTTP/1.1\r\nHost: alicesworld.tech\r\nConnection: keepalive\r\n\r\n";
  ws.send(payload);
});
ws.addEventListener("message", (event) => {
  let text = new TextDecoder().decode(event.data);
  console.log("message from stream 1: ", text.slice(0, 128));
});
```

The `wisp_client._wisp_connections` object will be used to manage the active Wisp connections. This object is able to store multiple active Wisp connections, identified by the websocket URL.

### Client Options:

`ClientConnection` and `WispWebSocket` both accept an additional argument which specifies additional options for the Wisp connection.

The following options are accepted:
- `wisp_version` - Sets the Wisp version to use for the client (either `1` or `2`). If Wisp v2 is used, Wisp v1 connections will still be accepted. Defaults to `2`. 
- `wisp_extensions` - Specifies custom Wisp v2 extensions to be used on the client. 

For example:
```js
let conn = new wisp.ClientConnection(ws_url, {wisp_version: 1});

let ws = new wisp.WispWebSocket(ws_url + "cloudflare.com:80", null, {wisp_version: 1});
```

## Server API:
### Importing the Server Library:
To use the library as an ES6 module, either in Node or using a bundler for the browser, include the following import:
```js
import { server as wisp } from "@mercuryworkshop/wisp-js/server";
```

To use it in Node with CommonJS:
```js
const { server: wisp } = require("@mercuryworkshop/wisp-js/client");
```

This is designed to be a drop-in replacement for [wisp-server-node](https://github.com/MercuryWorkshop/wisp-server-node). You can replace your old import with one of the above examples, and your application will still work in the same way.

### Basic Example:
This example uses the `node:http` module as a basic web server. It accepts new Wisp connections from incoming websockets.
```js
import { server as wisp } from "@mercuryworkshop/wisp-js/server";
import http from "node:http";

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("wisp server js rewrite");
});

server.on("upgrade", (req, socket, head) => {
  wisp.routeRequest(req, socket, head);
});

server.on("listening", () => {
  console.log("HTTP server listening");
});

server.listen(5001, "127.0.0.1");
```

### Example With Express:
```js
import { server as wisp } from "@mercuryworkshop/wisp-js/server";
import express from "express";
import morgan from "morgan";

const app = express();
const port = process.env.PORT || 5001;

app.use(morgan("combined"));
app.use(express.static("./"));

const server = app.listen(port, () => {
  console.log("Listening on port: ", port)
});

server.on("upgrade", (request, socket, head) => {
  wisp.routeRequest(request, socket, head);
});
```

### Change the Log Level:
By default, all info messages are shown. You can change this by importing `logging` from the module, and calling `logging.set_level` to set it to one of the following values:
- `logging.DEBUG`
- `logging.INFO` (default)
- `logging.WARN`
- `logging.ERROR`
- `logging.NONE`

```js
import { server as wisp, logging } from "@mercuryworkshop/wisp-js/server";

logging.set_level(logging.DEBUG);
```

### Changing Server Settings:
To change settings globally for the Wisp server, you can use the `wisp.options` object. Here is a list of all of the available settings:

**Blacklist / Whitelist Options:**
- `options.hostname_blacklist` - An array of regex objects to match against the destination server. Any matches will be blocked.
- `options.hostname_whitelist` - Same as `hostname_blacklist`, but only matches will be allowed through, and setting this will supersede `hostname_blacklist`.
- `options.port_blacklist` - An array of port numbers or ranges to block on the destination server. Specific ports are expressed as a single number, and ranges consist of a two element array containing the start and end. For example `80` and `[3000, 4000]` are both valid entries in this array.
- `options.port_whitelist` - Same as `port_whitelist`, but only matches will be allowed through, and setting this will supersede `port_blacklist`.

**Stream Restrictions:**
- `options.stream_limit_per_host` - The maximum number of streams that may be open to a single hostname, per connection. Defaults to no limit.
- `options.stream_limit_total` - The total number of streams that may be open to all hosts combined, per connection. Defaults to no limit.
- `options.allow_udp_streams` - If this is `false`, UDP streams will be blocked. Defaults to `true`.
- `options.allow_tcp_streams` - If this is `false`, TCP streams will be blocked. Defaults to `true`.

**IP Restrictions:**
- `options.allow_direct_ip` - Allow connections directly to IP addresses, which bypasses the server-side DNS resolution. Turning this off allows the server administrator to enforce a block list more effectively. Defaults to `true`.
- `options.allow_private_ips` - Allow connections to private IP addresses. Defaults to `false`.
- `options.allow_loopback_ips` - Allow connections to the server's localhost (127.0.0.1) and other loopback IPs. Defaults to `false`.
- `options.parse_real_ip` - Parse the client's real IP from the `X-Forwarded-For` and `X-Real-IP` headers. Defaults to `true`. 
- `options.parse_real_ip_from` - A list of IP addresses to allow parsing the real IP from. Defaults to `["127.0.0.1"]`.

**DNS Settings:**
- `options.dns_ttl` - The time to live for cached DNS responses, in seconds. Defaults to `120` seconds.
- `options.dns_method` - The method to use for DNS resolution. This is either `"lookup"`, which uses the system DNS, or `"resolve"`, which uses the Node `dns.resolve` functions. This may also be a custom async function, which takes the hostname as its only argument and returns the resolved IP address. Defaults to `"lookup"`.
- `options.dns_servers` - A [list of strings containing IP addresses](https://nodejs.org/api/dns.html#dnspromisessetserversservers) for custom DNS servers. This is only used if `dns_method` is set to `"resolve"`. By default, this is unset, and DNS queries will use the system DNS servers.
- `options.dns_result_order` - Controls whether or not IPv4 or IPv6 addresses are prioritized. This can be either `"ipv4first"`, `"ipv6first"`, or `"verbatim"`. `"verbatim"` uses the original order that the system DNS returns the results in, and only has special meaning if the DNS method is `"lookup"`. If the DNS method is `"resolve"`, `"verbatim"` is treated the same as `"ipv6first"`. Defaults to `"verbatim"`.

**Wisp V2 Options:**
- `options.wisp_version` - Sets the Wisp version to use for the server (either `1` or `2`). If Wisp v2 is used, Wisp v1 connections will still be accepted. Defaults to `2`. 
- `options.wisp_motd` - Sets the MOTD for the server if Wisp v2 is used. Defaults to `null`. 

For example:
```js
wisp.options.port_whitelist = [
  [5000, 6000],
  80,
  443
];
wisp.options.hostname_blacklist = [
  /google\.com/,
  /reddit\.com/,
];
```
```js
wisp.options.dns_method = "resolve";
wisp.options.dns_servers = ["1.1.1.3", "1.0.0.3"];
wisp.options.dns_result_order = "ipv4first";
```

## Copyright:
This library is licensed under the GNU AGPL v3.

### Copyright Notice:
```
wisp-js: a Wisp client implementation written in JavaScript
Copyright (C) 2024 Mercury Workshop

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published
by the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
```