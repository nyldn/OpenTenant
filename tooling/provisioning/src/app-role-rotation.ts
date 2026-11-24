import { createHash } from "node:crypto";
import { createAppRole, pooledHost, type AppRoleResult } from "./app-role";

export interface CredentialRotationRequest {
  ownerConnectionUri: string;
  roleName: string;
}

/** Secrets returned here are memory-only. Implementations must normalize all failures. */
export interface CredentialRotationPort {
  readonly targetId: string;
  rotate(request: CredentialRotationRequest): Promise<AppRoleResult>;
}

/** Existing Postgres-local SQL path. Hosted Neon must use its separately composed API adapter. */
export class PostgresCredentialRotation implements CredentialRotationPort {
  readonly targetId = "postgres-local";
  async rotate(request: CredentialRotationRequest): Promise<AppRoleResult> {
    try { return await createAppRole(request.ownerConnectionUri, request.roleName); }
    catch { throw new Error("Application credential rotation failed"); }
  }
}

/** Structural contract satisfied by database CredentialCipher, without adding a package dependency. */
export interface RotationCipher {
  encrypt(plaintext: string, aad: string): string;
  decrypt(ciphertext: string, aad: string): string;
}

export interface RotationCheckpointStore {
  /**
   * Serialize this target AND durably reserve it for runId until work succeeds.
   * Keep the reservation on failure/crash; reject other runs until this one resumes.
   */
  withLock<T>(target: string, runId: string, work: () => Promise<T>): Promise<T>;
  load(runId: string): Promise<string | null>;
  /** Atomic durable ciphertext replacement. No plaintext metadata or connection URI. */
  save(runId: string, ciphertext: string): Promise<void>;
}

export interface RotationDependencies {
  provider: CredentialRotationPort;
  cipher: RotationCipher;
  checkpoints: RotationCheckpointStore;
  /** Idempotently encrypt/store the application URI. Must never log it. */
  activate(appConnectionUri: string): Promise<void>;
}

type State = { phase: "intent" } | { phase: "rotated" | "completed"; appConnectionUri: string };

function targetIdentity(provider: CredentialRotationPort, request: CredentialRotationRequest): string {
  const uri = new URL(request.ownerConnectionUri);
  return createHash("sha256").update(JSON.stringify([provider.targetId, request.roleName,
    uri.protocol, uri.hostname, uri.port, uri.pathname])).digest("hex");
}

function readState(cipher: RotationCipher, ciphertext: string, aad: string, request: CredentialRotationRequest): State {
  const state = JSON.parse(cipher.decrypt(ciphertext, aad)) as State;
  if (state.phase === "intent") return { phase: "intent" };
  if (state.phase !== "rotated" && state.phase !== "completed") throw new Error();
  const uri = new URL(state.appConnectionUri);
  const owner = new URL(request.ownerConnectionUri);
  const expectedHost = owner.hostname.endsWith(".neon.tech") ? pooledHost(owner.hostname) : owner.hostname;
  if (uri.username !== request.roleName || !uri.password || uri.pathname !== owner.pathname ||
      uri.protocol !== owner.protocol || uri.hostname !== expectedHost || uri.port !== owner.port || uri.search !== owner.search) throw new Error();
  return state;
}

/**
 * Persist encrypted intent, then the new credential BEFORE activation. A failed
 * activation replays the same ciphertext without another provider reset. If the
 * provider reset succeeds but checkpointing fails, retry resets again before any
 * activation. This can temporarily interrupt logins; it cannot claim atomicity
 * across the provider and control plane. Callers must quiesce/pool-drain traffic.
 */
export async function rotateCredentialWithCheckpoint(
  deps: RotationDependencies,
  request: CredentialRotationRequest & { runId: string },
): Promise<void> {
  try {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(request.runId) || !/^[a-z][a-z0-9_]{0,62}$/.test(request.roleName)) throw new Error();
    const target = targetIdentity(deps.provider, request);
    const aad = JSON.stringify(["app-role-rotation-v1", request.runId, target]);
    await deps.checkpoints.withLock(target, request.runId, async () => {
      const encrypted = await deps.checkpoints.load(request.runId);
      let state: State = encrypted === null ? { phase: "intent" } : readState(deps.cipher, encrypted, aad, request);
      if (state.phase === "completed") return;
      if (state.phase === "intent") {
        if (encrypted === null) await deps.checkpoints.save(request.runId, deps.cipher.encrypt(JSON.stringify(state), aad));
        const result = await deps.provider.rotate(request);
        state = { phase: "rotated", appConnectionUri: result.appConnectionUri };
        // Authenticate/validate provider results before they can be activated.
        const ciphertext = deps.cipher.encrypt(JSON.stringify(state), aad);
        readState(deps.cipher, ciphertext, aad, request);
        await deps.checkpoints.save(request.runId, ciphertext);
      }
      await deps.activate(state.appConnectionUri);
      await deps.checkpoints.save(request.runId, deps.cipher.encrypt(JSON.stringify({ ...state, phase: "completed" }), aad));
    });
  } catch { throw new Error("Application credential rotation failed; resume the same run"); }
}
