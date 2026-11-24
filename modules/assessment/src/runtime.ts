import { browserLocation } from "@opentenant/platform-core/runtime-globals"
// Runtime contract for the Assessment module inside OpenTenant. Storage is
// local-first behind AssessmentRepository; the platform shell supplies
// configuration through ModuleContext rather than build-time environment data.

export const ASSESSMENT_SIGN_OUT_EVENT = "assessment-sign-out"
export const ASSESSMENT_VERSION = "v1.0.0"

export type AssessmentStorageMode = "local"

export interface AssessmentRuntimeBrand {
  displayName: string
  logoUrl: string | null
  markUrl: string | null
}

export interface AssessmentRuntimeConfig {
  /** Trusted tenant context supplied by the server-rendered platform shell. */
  tenantId?: string
  storageMode: AssessmentStorageMode
  readoutEndpoint: string
  publicUrl?: string
  exportSuffix: string
  /** Tenant brand injected by the platform shell; module renders it verbatim. */
  brand: AssessmentRuntimeBrand
}

interface AssessmentRuntimeEnv {
  ASSESSMENT_READOUT_ENDPOINT?: string
  ASSESSMENT_PUBLIC_URL?: string
  ASSESSMENT_EXPORT_SUFFIX?: string
}

function clean(value?: string): string | undefined {
  const normalized = value?.trim()
  return normalized || undefined
}

export function resolveAssessmentRuntimeConfig(env: AssessmentRuntimeEnv = {}): AssessmentRuntimeConfig {
  return {
    storageMode: "local",
    readoutEndpoint: clean(env.ASSESSMENT_READOUT_ENDPOINT) ?? "/api/assessment-readout",
    publicUrl: clean(env.ASSESSMENT_PUBLIC_URL),
    exportSuffix: clean(env.ASSESSMENT_EXPORT_SUFFIX) ?? "assessment",
    brand: { displayName: "OpenTenant", logoUrl: "/opentenant-logo.svg", markUrl: "/opentenant-mark.svg" },
  }
}

let activeConfig: AssessmentRuntimeConfig = resolveAssessmentRuntimeConfig()

/** The platform shell calls this once when mounting the module. */
export function configureAssessmentRuntime(config: Partial<AssessmentRuntimeConfig>): void {
  activeConfig = { ...resolveAssessmentRuntimeConfig(), ...config, storageMode: "local" }
}

export function getAssessmentRuntimeConfig(): AssessmentRuntimeConfig {
  return activeConfig
}

export function getAssessmentTenantId(): string | undefined {
  return activeConfig.tenantId
}

export function getAssessmentPublicUrl(): string {
  const configured = getAssessmentRuntimeConfig().publicUrl
  if (configured) return configured.replace(/\/$/, "")
  return browserLocation()?.origin ?? ""
}
