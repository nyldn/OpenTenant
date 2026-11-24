import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { recordFailure } from './failures.mjs';

test('CLI status, failures and resume prompt expose the same sanitized packet', () => {
  const root = mkdtempSync(join(tmpdir(), 'ot-failure-cli-'));
  try {
    mkdirSync(join(root, 'docs/plans'), { recursive: true });
    const task = { id: 'TASK-01', title: 'Repair task', priority: 1, lane: 'fix', status: 'not_verified', objective: 'Fix the defect', source: 'docs/spec.md', acceptanceCriteria: ['Test passes'], dependencies: [], ownerGate: false, allowedPaths: ['docs/'], timeoutMinutes: 5, verification: [['pnpm', 'test']] };
    writeFileSync(join(root, 'docs/plans/unattended-backlog.json'), JSON.stringify({ version: 1, updatedAt: '2026-11-11', tasks: [task] }));
    const packet = recordFailure(root, { taskId: task.id, stage: 'verification', command: ['pnpm', 'test'], log: 'expected two rows\nTOKEN=private', filesTouched: ['docs/spec.md'], baseHead: 'base', checkpointHead: 'checkpoint' });
    const cli = new URL('./cli.mjs', import.meta.url).pathname;
    /** @param {string} command */
    const invoke = command => execFileSync(process.execPath, [cli, command], { cwd: root, encoding: 'utf8' });
    assert.deepEqual(JSON.parse(invoke('failures')), [packet]);
    const status = JSON.parse(invoke('status'));
    assert.equal(status.awaitingVerification.id, task.id);
    assert.deepEqual(status.failures, [packet]);
    const prompt = invoke('prompt');
    assert.match(prompt, /expected two rows/); assert.equal(prompt.includes('private'), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
