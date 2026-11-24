import { createServer, createConnection } from 'node:net';
import { spawn } from 'node:child_process';

/** @param {string} containerName @param {string | undefined} socketPath */
export async function startLoopbackRelay(containerName, socketPath) {
  const sockets = new Set();
  const children = new Set();
  const server = createServer(socket => {
    if (socketPath) {
      const upstream = createConnection(socketPath);
      sockets.add(socket); sockets.add(upstream);
      socket.on('error', () => upstream.destroy()); upstream.on('error', () => socket.destroy());
      socket.on('close', () => { sockets.delete(socket); upstream.destroy(); });
      upstream.on('close', () => { sockets.delete(upstream); socket.destroy(); });
      socket.pipe(upstream); upstream.pipe(socket);
      return;
    }
    // PostgreSQL has only container loopback. Docker transports binary protocol
    // over stdio; the child never receives credentials in argv or environment.
    const child = spawn('docker', ['exec', '-i', containerName, 'bash', '-c',
      'exec 3<>/dev/tcp/127.0.0.1/5432; cat <&3 & relay_pid=$!; cat >&3; kill "$relay_pid" 2>/dev/null; wait "$relay_pid" 2>/dev/null || true'],
      { stdio: ['pipe', 'pipe', 'ignore'], timeout: 30 * 60 * 1000,
        env: { PATH: process.env.PATH, HOME: process.env.HOME, DOCKER_HOST: process.env.DOCKER_HOST, DOCKER_CONTEXT: process.env.DOCKER_CONTEXT } });
    sockets.add(socket); children.add(child);
    socket.pipe(child.stdin); child.stdout.pipe(socket);
    child.on('error', () => socket.destroy());
    child.on('exit', () => { children.delete(child); socket.destroy(); });
    socket.on('error', () => child.stdin.end());
    socket.on('close', () => { sockets.delete(socket); child.stdin.end(); });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(undefined)); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('PostgreSQL loopback proxy failed');
  const port = address.port;
  return {
    port,
    async dispose() {
      for (const socket of sockets) socket.destroy();
      for (const child of children) { child.stdin.end(); child.kill('SIGTERM'); }
      await new Promise(resolve => server.close(() => resolve(undefined)));
    },
  };
}
