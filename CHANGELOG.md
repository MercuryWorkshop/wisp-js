## v0.4.0 (9/26/25):
- Add support for Wisp v2 on the client and server
- Allow configuring the server MOTD
- Fix several bugs
- Improve compatibility for older browsers
- Add source maps in the NPM package

## v0.3.3 (10/27/24):
- Fix improper serialization of CLOSE packets

## v0.3.2 (9/30/24):
- Added support for getting the client's real IP from the `X-Forwarded-For` and the `X-Real-IP` headers

## v0.3.1 (9/27/24):
- Add an option to the server CLI for setting the config based on a JSON string

## v0.3.0 (9/26/24):
- Add server options for advanced DNS settings
- Implement multiple modes for DNS resolution
- Add support for setting custom DNS servers

## v0.2.2 (9/25/24):
- Add server options for restricting access to certain IP ranges
- Add a DNS cache for improved performance

## v0.2.1 (9/19/24):
- Add support for JSON configuration files in the server CLI

## v0.2.0 (9/19/24):
- Added a CLI interface to the Wisp server
- Implemented a new `npx wisp-js-server` command

## v0.1.2 (9/18/24):
- Use Webpack for bundling the dist files
- Add CommonJS support

## v0.1.1 (7/18/24):
- Enable TCP_NODELAY on the underlying TCP sockets
- Fix errors related to resuming sockets

## v0.1.0 (7/13/24):
- Initial release on NPM
- Includes async Wisp server
- Includes rewritten Wisp client and packet parsing
- Add configurable logging options
- Add whitelist/blacklist options for the server