import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { runIsolatedVerificationProcess } from './runner-verification.mjs';

test('noisy verification stays bounded without killing its cleanup supervisor', () => {
  const result = runIsolatedVerificationProcess(process.execPath, process.execPath,
    ['-e', 'process.stdout.write("x".repeat(25 * 1024 * 1024))'], tmpdir(), { PATH: process.env.PATH }, 30000);
  assert.equal(result.status, 0);
  assert.ok(String(result.stdout).length <= 16384);
});
