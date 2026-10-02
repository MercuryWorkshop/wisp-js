import { close_reasons, stream_types } from "../packet.mjs";
import { options } from "./options.mjs";
import * as net from "./net.mjs";

import ipaddr from "ipaddr.js";

export class AccessDeniedError extends Error {}

//helper functions for the whitelist/blacklist logic
function check_port_range(entry, port) {
  return (entry === port) || (entry[0] <= port && entry[1] >= port)
}
function check_whitelist(entries, filter) {
  let matched = false;
  for (let entry of entries) {
    if (filter(entry)) {
      matched = true;
      break
    }
  }
  return !matched;
}
function check_blacklist(entries, filter) {
  for (let entry of entries) {
    if (filter(entry))
      return true;
    }
  return false;
}

function check_ip_range(ip, range) {
  return range.includes(ip.range());
}

//check if an ip is blocked
export function is_ip_blocked(ip_str, opts = options) {
  if (!ipaddr.isValid(ip_str)) 
    return false;
  let ip = ipaddr.parse(ip_str);

  let loopback_ranges = ["loopback", "unspecified"];
  let private_ranges = ["broadcast", "linkLocal", "carrierGradeNat", "private", "reserved"];

  if (!opts.allow_loopback_ips && check_ip_range(ip, loopback_ranges)) 
    return true;
  if (!opts.allow_private_ips && check_ip_range(ip, private_ranges)) 
    return true;
  return false;
}

//returns the close reason if the connection should be blocked
//a connection can carry its own filter options (passed to routeRequest as
//conn_options.filter_options), which take precedence over the global ones.
//this lets one server apply different policies on different paths.
export async function is_stream_allowed(connection, type, hostname, port) {
  let opts = (connection && connection.filter_options) 
    ? {...options, ...connection.filter_options} 
    : options;

  //check if tcp or udp should be blocked
  if (!opts.allow_tcp_streams && type === stream_types.TCP)
    return close_reasons.HostBlocked;
  if (!opts.allow_udp_streams && type === stream_types.UDP)
    return close_reasons.HostBlocked;

  //check the hostname whitelist/blacklist
  if (opts.hostname_whitelist) {
    if (check_whitelist(opts.hostname_whitelist, (entry) => entry.test(hostname)))
      return close_reasons.HostBlocked;
  }
  else if (opts.hostname_blacklist) {
    if (check_blacklist(opts.hostname_blacklist, (entry) => entry.test(hostname)))
      return close_reasons.HostBlocked;
  }

  //check if the port is blocked
  if (opts.port_whitelist) {
    if (check_whitelist(opts.port_whitelist, (entry) => check_port_range(entry, port))) 
      return close_reasons.HostBlocked;
  }
  else if (opts.port_blacklist) {
    if (check_blacklist(opts.port_blacklist, (entry) => check_port_range(entry, port)))
      return close_reasons.HostBlocked;
  }

  //check if the destination ip is blocked
  let ip_str = hostname;
  if (ipaddr.isValid(hostname)) {
    if (!opts.allow_direct_ip)
      return close_reasons.HostBlocked;
  }
  else {
    try { //look up the ip to make sure that the resolved address is allowed
      ip_str = await net.lookup_ip(hostname);
    }
    catch {}
  }
  if (is_ip_blocked(ip_str, opts)) 
    return close_reasons.HostBlocked;

  //don't check stream counts if there isn't an associated wisp connection (with wsproxy for example)
  if (!connection) 
    return 0;

  //check for stream count limits
  if (opts.stream_limit_total !== -1 && Object.keys(connection.streams).length >= opts.stream_limit_total) 
    return close_reasons.ConnThrottled;
  if (opts.stream_limit_per_host !== -1) {
    let streams_per_host = 0;
    for (let stream of connection.streams) {
      if (stream.socket.hostname === hostname) {
        streams_per_host++;
      }
    }
    if (streams_per_host >= opts.stream_limit_per_host)
      return close_reasons.ConnThrottled;
  }

  return 0;
}