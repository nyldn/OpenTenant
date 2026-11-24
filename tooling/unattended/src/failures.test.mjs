import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordFailure, latestFailure, failureDisposition, redactLog } from './failures.mjs';
import { buildTaskPrompt } from './runner-agent.mjs';

test('redacts URLs, bearer tokens, assignment secrets and explicit values before trimming', () => {
  const log = 'postgresql://user:sensitive@localhost/db Authorization: Bearer abcdef\nAPI_KEY=hidden\npartial=known-value';
  const clean = redactLog(log, ['known-value']);
  for (const secret of ['sensitive', 'abcdef', 'hidden', 'known-value']) assert.equal(clean.includes(secret), false);
});

test('failure packets preserve task context and cap automatic repair at two retries', () => {
  const root = mkdtempSync(join(tmpdir(), 'ot-failure-'));
  try {
    for (let i = 1; i <= 3; i++) {
      const packet = recordFailure(root, { taskId: 'TASK-01', stage: 'verification', command: ['pnpm', 'test'], log: 'x'.repeat(20000) + '\nTOKEN=hidden', filesTouched: ['src/example.ts'], baseHead: 'base', checkpointHead: 'checkpoint' });
      assert.equal(packet.attempt, i);
      assert.ok(packet.logTail.length <= 8192);
      assert.equal(packet.logTail.includes('hidden'), false);
      assert.equal(failureDisposition(root, 'TASK-01'), i <= 2 ? 'retry' : 'blocked');
    }
    assert.deepEqual(latestFailure(root, 'TASK-01').filesTouched, ['src/example.ts']);
    assert.equal(readFileSync(join(root, '.opentenant/unattended/failures.jsonl'), 'utf8').includes('hidden'), false);
    assert.equal(latestFailure(root, 'OTHER'), undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('resumed prompts carry failure context without changing the task contract', () => {
  /** @type {import('./backlog.mjs').UnattendedTask} */
  const task = { priority: 1, status: 'not_verified', dependencies: [], ownerGate: false, timeoutMinutes: 5, verification: [['pnpm', 'test']], id: 'TASK-01', title: 'Fix', lane: 'fix', objective: 'Fix it', source: 'test', acceptanceCriteria: ['works'], allowedPaths: ['src/'] };
  const before = JSON.stringify(task);
  const prompt = buildTaskPrompt(task, false, { taskId: task.id, command: ['pnpm', 'test'], logTail: 'expected 2, received 1' });
  assert.match(prompt, /expected 2, received 1/);
  assert.match(prompt, /untrusted diagnostic/);
  assert.equal(JSON.stringify(task), before);
});
