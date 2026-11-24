import type { SandboxCreateRequest, SandboxTemplateRef } from "../contracts";
import { sandboxFailure } from "./isolated";

/** Installation-owned, reviewed image. Never accept this mapping from a tenant. */
export interface ProviderTemplate {
  readonly ref: SandboxTemplateRef;
  readonly image: string;
  readonly cpuCores: number;
  readonly memoryMb: number;
}

export function approvedTemplate(templates: readonly ProviderTemplate[], request: SandboxCreateRequest): ProviderTemplate {
  const template = templates.find((entry) => entry.ref.id === request.template.id && entry.ref.version === request.template.version && entry.ref.digest === request.template.digest);
  if (!template || template.cpuCores !== request.limits.cpuCores || template.memoryMb !== request.limits.memoryMb) throw sandboxFailure("create", "policy_denied");
  return template;
}
