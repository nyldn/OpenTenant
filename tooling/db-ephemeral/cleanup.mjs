// Independent cleanup on parent/worker death. Resource names are random and
// validated; no SQL, connection strings or passwords enter this process.
import { rmSync } from 'node:fs';
import { basename } from 'node:path';
import { spawnSync } from 'node:child_process';
const name = process.argv[2] ?? '';
if (!/^opentenant-proof-[a-f0-9-]{36}$/.test(name)) process.exit(1);
const socketRoot = process.argv[3];
if (socketRoot && basename(socketRoot) !== name) process.exit(1);
process.stdin.resume();
process.stdin.once('end', () => {
  spawnSync('docker', ['rm', '-fv', name], { stdio: 'ignore', timeout: 30_000, shell: false });
  if (socketRoot) rmSync(socketRoot, { recursive: true, force: true });
});
