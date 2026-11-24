export type LifecycleAction = "suspend" | "resume" | "delete" | "cancel_delete";

export function lifecycleTransition(status: string, action: LifecycleAction, now: Date, retentionHours: number, deletion?: { priorStatus?: string; eraseAfter: Date | null; erasureStarted: boolean }): { status: string; eraseAfter?: Date } {
  if (action === "suspend" && status === "active") return { status: "suspended" };
  if (action === "resume" && status === "suspended") return { status: "active" };
  if (action === "delete" && ["active", "suspended"].includes(status)) {
    if (!Number.isFinite(retentionHours) || retentionHours < 1 || retentionHours > 87600) throw new Error("Invalid retention period");
    return { status: "deleted", eraseAfter: new Date(now.getTime() + retentionHours * 3600000) };
  }
  if (action === "cancel_delete" && status === "deleted" && deletion &&
    !deletion.erasureStarted && deletion.eraseAfter && deletion.eraseAfter > now &&
    ["active", "suspended"].includes(deletion.priorStatus ?? "")) return { status: deletion.priorStatus! };
  throw new Error("Invalid tenant lifecycle transition");
}

export function suspendedTenantResponse(): Response {
  return new Response("Tenant suspended", { status: 423, headers: { "cache-control": "no-store" } });
}

export function validateOwnerEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Invalid owner email");
  return email;
}
