import type {
  AttachmentMetadata,
  AttachmentRecord,
  DeliverySafeErrorClass,
  SupportAuthority,
  SupportDepthTicket,
} from "./support-depth-types";

export const DELIVERY_MAX_ATTEMPTS = 3;
export const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,119}$/;
export const ALLOWED_MEDIA_TYPES = new Set([
  "text/plain",
  "text/csv",
  "application/pdf",
  "image/png",
  "image/jpeg",
]);
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const DELIVERY_SAFE_ERROR_CLASSES = new Set<DeliverySafeErrorClass>([
  "transient",
  "permanent",
  "destination_unavailable",
]);

export function now(): string {
  return new Date().toISOString();
}

export function has(authority: SupportAuthority, permission: string): boolean {
  return authority.permissions.includes(permission);
}

export function validManagedSession(authority: SupportAuthority, tenantId: string): boolean {
  const expiresAt = Date.parse(authority.supportSession?.expiresAt ?? "");
  return (
    (authority.kind === "installation_owner" || authority.kind === "managed_support") &&
    authority.supportSession?.tenantId === tenantId &&
    authority.supportSession.operatorId === authority.actorId &&
    SAFE_REFERENCE.test(authority.supportSession.id) &&
    Number.isFinite(expiresAt) &&
    expiresAt > Date.now()
  );
}

export function canReadTicket(authority: SupportAuthority, ticket: SupportDepthTicket): boolean {
  if (authority.tenantId !== ticket.tenantId) return false;
  if (
    authority.kind === "requester" &&
    authority.actorId === ticket.requesterId &&
    has(authority, "support.ticket.read_own")
  ) {
    return true;
  }
  if (authority.kind === "tenant_admin" && has(authority, "support.ticket.read_tenant")) {
    return true;
  }
  return (
    (authority.kind === "installation_owner" || authority.kind === "managed_support") &&
    has(authority, "owner.support.customer_data.read") &&
    validManagedSession(authority, ticket.tenantId)
  );
}

export function canRegisterAttachment(
  authority: SupportAuthority,
  ticket: SupportDepthTicket,
): boolean {
  if (authority.tenantId !== ticket.tenantId) return false;
  if (
    authority.kind === "requester" &&
    authority.actorId === ticket.requesterId &&
    has(authority, "support.ticket.reply_own")
  ) {
    return true;
  }
  return authority.kind === "tenant_admin" && has(authority, "support.ticket.reply");
}

export function attachmentMetadata(record: AttachmentRecord): AttachmentMetadata {
  const { objectRef: _objectRef, ...metadata } = record;
  return metadata;
}
