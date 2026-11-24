export { SUPPORT_MANIFEST } from "./manifest";
export { SupportSurface } from "./SupportSurface";
export {
  addMessage,
  assignTicket,
  createTicket,
  getTicket,
  getTicketByNumber,
  listTicketSummaries,
  listTickets,
  setPriority,
  setStatus,
} from "./ticket-store";
export type { SupportClient } from "./ticket-store";
export {
  OUTBOX_CLAIM_TIMEOUT_MINUTES,
  OUTBOX_MAX_ATTEMPTS,
  claimPendingOutboxEvents,
  latestOutboxEventId,
  listDeadOutboxEvents,
  markOutboxDelivered,
  markOutboxFailed,
} from "./outbox";
export type {
  MessageType,
  OutboxEventKind,
  OutboxEventRecord,
  OutboxEventStatus,
  SupportPermission,
  TicketCategory,
  TicketEventKind,
  TicketEventRecord,
  TicketMessageRecord,
  TicketOutboxEnvelope,
  TicketPriority,
  TicketRecord,
  TicketStatus,
  SupportTicketSummary,
} from "./types";
export {
  EncryptedSlackCredentialBoundary,
  InMemorySlackTransport,
  LocalSlackDeliveryAdapter,
  SlackDeliveryError,
  projectSlackTicketMessage,
} from "./slack-delivery";
export {
  InMemorySlackAppStore,
  SlackAppContractService,
  SyntheticSlackActionVerifier,
} from "./slack-app";
export type {
  SignedSlackAction,
  SlackActionAuthority,
  SlackActionPayload,
  SlackActionVerifier,
  SlackAppChannel,
  SlackAppConnection,
  SlackIdentityMapping,
  SlackTicketAction,
  SlackTicketThread,
} from "./slack-app";
export {
  DELIVERY_MAX_ATTEMPTS,
  InMemorySupportDepthStore,
  SupportDepthService,
  SyntheticDeliveryTransport,
} from "./support-depth";
export type {
  AttachmentMetadata,
  AttachmentRecord,
  CsatRecord,
  DeliveryAttempt,
  DeliveryChannel,
  DeliveryEvent,
  DeliveryPreference,
  DeliverySafeErrorClass,
  DeliveryStatus,
  DeliveryTransport,
  SlaPolicy,
  SlaStateRecord,
  SupportAuthority,
  SupportDepthTicket,
  SupportEvidence,
} from "./support-depth";
export type {
  SlackCredentialBoundary,
  SlackCredentialCipher,
  SlackDeliveryHealth,
  SlackMessage,
  SlackSafeErrorClass,
  SlackTicketNotification,
  SlackTransport,
  SyntheticSlackDelivery,
} from "./slack-delivery";
export {
  SUPPORT_PERMISSIONS,
  SUPPORT_REQUESTER_PERMISSIONS,
  SUPPORT_STAFF_PERMISSIONS,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  expandSupportPermissions,
  outboxIdempotencyKey,
} from "./types";
export {
  InMemorySupportAiStore,
  SupportAiService,
  SyntheticSuggestionAdapter,
  evaluateOfflineSupportAi,
} from "./support-ai";
export type {
  AdapterSuggestion,
  KnowledgeArticle,
  KnowledgeChunk,
  KnowledgeProvenance,
  KnowledgeRedaction,
  KnowledgeScope,
  KnowledgeStatus,
  OfflineSupportAiEvaluationInput,
  OfflineSupportAiEvaluationResult,
  SuggestionAdapter,
  SuggestionCitation,
  SuggestionDraft,
  SuggestionOutcome,
  SupportAiAuthority,
  SupportAiEvidence,
  SupportAiInferenceEvidence,
  SupportAiTicketInput,
} from "./support-ai";
export { SupportEmailDeliveryTransport, createSupportDeliveryService } from './email-delivery';
export type { SupportEmailDirectory } from './email-delivery';

export type { HelpdeskSource } from "./services";

export { createSupportAiApi } from "./support-ai-api";
export type { AiDependencies, AiRequest, AiPolicy, AiAttempt, SupportAiInferencePort } from "./support-ai-review-types";
