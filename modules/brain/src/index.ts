export { BrainSurface } from "./BrainSurface";
export { BRAIN_CHUNKING_PROFILES } from "./chunking";
export type { ChunkingProfile, ChunkingProfileName } from "./chunking";
export {
  BrainDecisionChainStore,
  decisionHash,
  verifyDecisionChain,
} from "./decisions-chain";
export type {
  BrainDecisionEvent,
  DecisionChainClient,
  DecisionChainPool,
} from "./decisions-chain";
export type {
  EmbeddingDocument,
  EmbeddingProvider,
  EmbeddingResult,
} from "./embeddings";
export { embeddingProviderKeyFromEnv } from "./embeddings";
export { LocalEmbeddingAdapter } from "./embeddings";
export { BRAIN_TOOLS, executeBrainTool } from "./mcp-service";
export type { BrainStorage, BrainMcpDependencies, BrainTool } from "./mcp-service";
export { BRAIN_MANIFEST } from "./manifest";
export { oauthVaultAad, quarantineAad } from "./oauth-vault";
export {
  executeConnectorBatch,
  toRawSignalRecord,
} from "./source-connector";
export type {
  ConnectorBatch,
  ConnectorCursor,
  ConnectorCursorStore,
  ConnectorExecutionResult,
  ConnectorFetchInput,
  NormalizedSignal,
  QuarantineWriter,
  SourceConnector,
} from "./source-connector";
export type {
  BrainDecisionRecord,
  BrainEntity,
  BrainEntityAlias,
  BrainQuarantineRecord,
  ContextEdgeRecord,
  RawSignalChunkRecord,
  RawSignalPayloadRecord,
  RawSignalRecord,
  TrustTier,
  ValidatedContextRecord,
  Visibility,
} from "./spine";

export { handleBrainRequest } from "./host-api";
export type { BrainCallOptions } from "./service";
