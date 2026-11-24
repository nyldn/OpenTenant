import { describe, expect, it } from "vitest"
import { configureAssessmentRuntime, getAssessmentRuntimeConfig, resolveAssessmentRuntimeConfig } from "./runtime"

// These tests protect the module's local-only runtime contract.
describe("resolveAssessmentRuntimeConfig", () => {
  it("defaults to browser-local storage", () => {
    expect(resolveAssessmentRuntimeConfig({})).toEqual({
      storageMode: "local",
      readoutEndpoint: "/api/assessment-readout",
      publicUrl: undefined,
      exportSuffix: "assessment",
      brand: { displayName: "OpenTenant", logoUrl: "/opentenant-logo.svg", markUrl: "/opentenant-mark.svg" },
    })
  })

  it("applies configured endpoint and export suffix", () => {
    expect(
      resolveAssessmentRuntimeConfig({
        ASSESSMENT_READOUT_ENDPOINT: "/api/custom-readout",
        ASSESSMENT_EXPORT_SUFFIX: "example",
      }),
    ).toMatchObject({
      readoutEndpoint: "/api/custom-readout",
      exportSuffix: "example",
    })
  })

  it("storage mode cannot be configured away from local", () => {
    configureAssessmentRuntime({ exportSuffix: "example" })
    expect(getAssessmentRuntimeConfig().storageMode).toBe("local")
    expect(getAssessmentRuntimeConfig().exportSuffix).toBe("example")
    configureAssessmentRuntime({})
  })
})
