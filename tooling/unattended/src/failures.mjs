// @ts-check
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const MAX_RETRIES = 2;
/** @param {string} log @param {string[]} [secrets] */
export function redactLog(log, secrets = []) {
  // Strip terminal control sequences before storing untrusted diagnostics.
  // eslint-disable-next-line no-control-regex
  let clean = log.replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, '');
  for (const secret of secrets.filter(value => value.length >= 4).sort((a, b) => b.length - a.length)) {
    clean = clean.replaceAll(secret, '[REDACTED]');
  }
  return clean
    .replace(/\b(?:postgres(?:ql)?|https?):\/\/[^\s@/]+@/giu, 'redacted://[REDACTED]@')
    .replace(/\bBearer\s+[^\s]+/giu, 'Bearer [REDACTED]')
    .replace(/((?:[\w]*(?:password|passwd|secret|token|api[_-]?key|credential)[\w]*)["']?\s*[:=]\s*)[^\r\n,;]+/giu, '$1[REDACTED]');
}
/** @param {string} root */
export function readFailures(root) {
  const path = join(root, '.opentenant/unattended/failures.jsonl');
  if (!existsSync(path)) return [];
  // Malformed controller state fails closed rather than resetting retry counts.
  return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}
/** @param {string} root @param {string} taskId */
export function latestFailure(root, taskId) {
  return readFailures(root).filter(packet => packet.taskId === taskId).at(-1);
}
/** @param {string} root @param {string} taskId */
export function failureDisposition(root, taskId) {
  const packet = latestFailure(root, taskId);
  return !packet ? 'none' : packet.attempt > MAX_RETRIES ? 'blocked' : 'retry';
}
/**
 * @param {string} root
 * @param {{taskId: string, stage: string, command: string[], log: string, filesTouched: string[], baseHead: string, checkpointHead: string}} failure
 * @param {string[]} [secrets]
 */
export function recordFailure(root, failure, secrets = []) {
  const packet = {
    version: 1, taskId: failure.taskId, stage: failure.stage,
    attempt: (latestFailure(root, failure.taskId)?.attempt ?? 0) + 1,
    retryLimit: MAX_RETRIES, at: new Date().toISOString(),
    command: failure.command.map(value => redactLog(value, secrets)),
    logTail: redactLog(failure.log, secrets).slice(-8192),
    filesTouched: failure.filesTouched.map(value => redactLog(value, secrets)),
    baseHead: failure.baseHead, checkpointHead: failure.checkpointHead,
  };
  mkdirSync(join(root, '.opentenant/unattended'), { recursive: true, mode: 0o700 });
  writeFileSync(join(root, '.opentenant/unattended/failures.jsonl'), `${JSON.stringify(packet)}\n`, { flag: 'a', mode: 0o600 });
  return packet;
}
