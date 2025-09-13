import { WispBuffer } from "./packet.mjs";

class EmptyPayload {
  constructor() {}
  static parse() {
    return new EmptyPayload();
  }
  serialize() {
    return new WispBuffer(0);
  }
}

export class BaseExtension {
  static id = 0x00;
  static name = "";

  static Server = EmptyPayload;
  static Client = EmptyPayload;

  constructor({server_config, client_config} = {}) {
    this.id = this.constructor.id;
    this.name = this.constructor.name;
    if (server_config)
      this.payload = new this.constructor.Server(server_config);
    else if (client_config)
      this.payload = new this.constructor.Client(client_config);
  }
  static parse(ext_class, buffer, role) {
    let extension = new ext_class({});
    if (role === "client")
      extension.payload = ext_class.Client.parse(buffer.slice(5));
    else if (role === "server")
      extension.payload = ext_class.Server.parse(buffer.slice(5));
    else 
      throw TypeError("invalid role");
    return extension;
  }
  serialize() {
    let buffer = new WispBuffer(5);
    let payload_buffer = this.payload.serialize();
    buffer.view.setInt8(0, this.constructor.id);
    buffer.view.setUint32(1, payload_buffer.size, true);
    return buffer.concat(payload_buffer);
  }
}

export class UDPExtension extends BaseExtension {
  static id = 0x01;
  static name = "UDP";
}

export class PasswordAuthExtension extends BaseExtension {
  static id = 0x02;
  static name = "Password Authentication";

  static Server = class {
    constructor({required = 1}) {
      this.required = required ? 1 : 0;
    }
    static parse(buffer) {
      return new PasswordAuthExtension.Server({
        required: buffer.view.getUint8(0)
      });
    }
    serialize() {
      let buffer = new WispBuffer(1);
      buffer.view.setUint8(0, this.required);
      return buffer;
    }
  }

  static Client = class {
    constructor({username, password}) {
      this.username = username;
      this.password = password;
    }
    static parse(buffer) {
      let username_len = buffer.view.getUint8(0);
      let password_len = buffer.view.getUint16(1, true);
      let password_index = username_len + 3;
      return new PasswordAuthExtension.Client({
        username: buffer.slice(3, username_len).get_string(),
        password: buffer.slice(password_index, password_len).get_string()
      });
    }
    serialize() {
      let username_buffer = new WispBuffer(this.username);
      let password_buffer = new WispBuffer(this.password);
      let buffer = new WispBuffer(3);
      buffer.view.setUint8(0, username_buffer.size);
      buffer.view.setUint16(1, password_buffer.size, true);
      return buffer.concat(username_buffer).concat(password_buffer);
    }
  }
}

export class MOTDExtension extends BaseExtension {
  static id = 0x04;
  static name = "Server MOTD";

  static Server = class {
    constructor({message}) {
      this.message = message;
    }
    static parse(buffer) {
      return new MOTDExtension.Server({
        message: buffer.get_string()
      });
    }
    serialize() {
      return new WispBuffer(this.message);
    }
  }

  static Client = EmptyPayload;
}

export function parse_extensions(payload_buffer, valid_extensions, role) {
  let index = 0;
  let parsed_extensions = [];
  while (payload_buffer.size) {
    let ext_id = payload_buffer.view.getUint8(index);
    let ext_len = payload_buffer.view.getUint32(index + 1, true);
    let ext_payload = payload_buffer.slice(0, 5 + ext_len);
    let ext_class;
    for (let extension of valid_extensions) {
      if (extension.id !== ext_id) 
        continue;
      ext_class = extension.constructor;
      break;
    }
    if (ext_class) {
      let ext_parsed = BaseExtension.parse(ext_class, ext_payload, role);
      parsed_extensions.push(ext_parsed);
    }
    payload_buffer = payload_buffer.slice(5 + ext_len);
  }
  return parsed_extensions;
}

export function serialize_extensions(extensions) {{
  let ext_buffer = new WispBuffer(0);
  for (let extension of extensions) {
    ext_buffer = ext_buffer.concat(extension.serialize());
  }
  return ext_buffer;
}}

export const extensions_map = {
  0x01: UDPExtension,
  0x02: PasswordAuthExtension,
  0x04: MOTDExtension
}