import { WispBuffer } from "./packet";

export type ExtensionRole = "client" | "server";

export interface ExtensionPayload {
  serialize(): WispBuffer;
}

//the static side of an extension payload class
//the config type differs for every payload, so it can't be narrowed here
export interface ExtensionPayloadClass {
  new (config: any): ExtensionPayload;
  parse(buffer: WispBuffer): ExtensionPayload;
}

export interface ExtensionOptions {
  server_config?: unknown;
  client_config?: unknown;
}

class EmptyPayload {
  constructor() {}
  static parse(): EmptyPayload {
    return new EmptyPayload();
  }
  serialize(): WispBuffer {
    return new WispBuffer(0);
  }
}

export class BaseExtension {
  static id: number = 0x00;
  static name: string = "";

  static Server: ExtensionPayloadClass = EmptyPayload;
  static Client: ExtensionPayloadClass = EmptyPayload;

  id: number;
  name: string;
  payload?: ExtensionPayload;

  constructor({server_config, client_config}: ExtensionOptions = {}) {
    let ext_class = this.constructor as typeof BaseExtension;
    this.id = ext_class.id;
    this.name = ext_class.name;
    if (server_config)
      this.payload = new ext_class.Server(server_config);
    else if (client_config)
      this.payload = new ext_class.Client(client_config);
  }
  static parse(ext_class: typeof BaseExtension, buffer: WispBuffer, role: ExtensionRole): BaseExtension {
    let extension = new ext_class({});
    if (role === "client")
      extension.payload = ext_class.Client.parse(buffer.slice(5));
    else if (role === "server")
      extension.payload = ext_class.Server.parse(buffer.slice(5));
    else
      throw TypeError("invalid role");
    return extension;
  }
  serialize(): WispBuffer {
    if (!this.payload) {
      throw TypeError("cannot serialize an extension without a payload");
    }
    let buffer = new WispBuffer(5);
    let payload_buffer = this.payload.serialize();
    buffer.view.setInt8(0, (this.constructor as typeof BaseExtension).id);
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
    required: number;

    constructor({required = 1}: {required?: number | boolean}) {
      this.required = required ? 1 : 0;
    }
    static parse(buffer: WispBuffer) {
      return new PasswordAuthExtension.Server({
        required: buffer.view.getUint8(0)
      });
    }
    serialize(): WispBuffer {
      let buffer = new WispBuffer(1);
      buffer.view.setUint8(0, this.required);
      return buffer;
    }
  }

  static Client = class {
    username: string;
    password: string;

    constructor({username, password}: {username: string, password: string}) {
      this.username = username;
      this.password = password;
    }
    static parse(buffer: WispBuffer) {
      let username_len = buffer.view.getUint8(0);
      let password_len = buffer.view.getUint16(1, true);
      let password_index = username_len + 3;
      return new PasswordAuthExtension.Client({
        username: buffer.slice(3, password_index).get_string(),
        password: buffer.slice(password_index, password_index + password_len).get_string()
      });
    }
    serialize(): WispBuffer {
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
    message: string;

    constructor({message}: {message: string}) {
      this.message = message;
    }
    static parse(buffer: WispBuffer) {
      return new MOTDExtension.Server({
        message: buffer.get_string()
      });
    }
    serialize(): WispBuffer {
      return new WispBuffer(this.message);
    }
  }

  static Client = EmptyPayload;
}

export function parse_extensions(payload_buffer: WispBuffer, valid_extensions: BaseExtension[], role: ExtensionRole): BaseExtension[] {
  let index = 0;
  let parsed_extensions: BaseExtension[] = [];
  while (payload_buffer.size) {
    let ext_id = payload_buffer.view.getUint8(index);
    let ext_len = payload_buffer.view.getUint32(index + 1, true);
    let ext_payload = payload_buffer.slice(0, 5 + ext_len);
    let ext_class: typeof BaseExtension | undefined;
    for (let extension of valid_extensions) {
      if (extension.id !== ext_id)
        continue;
      ext_class = extension.constructor as typeof BaseExtension;
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

export function serialize_extensions(extensions: BaseExtension[]): WispBuffer {
  let ext_buffer = new WispBuffer(0);
  for (let extension of extensions) {
    ext_buffer = ext_buffer.concat(extension.serialize());
  }
  return ext_buffer;
}

export const extensions_map = {
  0x01: UDPExtension,
  0x02: PasswordAuthExtension,
  0x04: MOTDExtension
} as const satisfies Record<number, typeof BaseExtension>;
