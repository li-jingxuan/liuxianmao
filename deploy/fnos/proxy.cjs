const fs = require('node:fs');
const net = require('node:net');

const socketPath = process.env.GATEWAY_SOCKET;
if (!socketPath) throw new Error('GATEWAY_SOCKET is required');

const existingPath = fs.lstatSync(socketPath, { throwIfNoEntry: false });
if (existingPath) {
  if (!existingPath.isSocket()) {
    throw new Error('Refusing to replace a non-socket at GATEWAY_SOCKET');
  }
  fs.unlinkSync(socketPath);
}

// fnOS connects from outside the container. A transparent stream preserves the
// gateway's HTTP path, forwarded headers and upgrades verbatim.
process.umask(0o000);
const server = net.createServer({ allowHalfOpen: true }, (client) => {
  const upstream = net.createConnection({ host: 'web', port: 3000, allowHalfOpen: true });
  client.on('error', () => upstream.destroy());
  upstream.on('error', () => client.destroy());
  client.pipe(upstream).pipe(client);
});

server.listen(socketPath);
