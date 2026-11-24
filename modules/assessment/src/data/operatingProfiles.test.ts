import { describe, expect, it } from "vitest"
import { PILLARS } from "./pillars"
import {
  OPERATING_PROFILES,
  operatingProfileQuestionCount,
  operatingProfileQuestionTips,
} from "./operatingProfiles"

describe("synthetic operating-profile question tips", () => {
  it("contains a compact synthetic prompt library", () => {
    expect(OPERATING_PROFILES).toHaveLength(4)
    expect(operatingProfileQuestionCount()).toBe(80)
  })

  it("provides one contextual tip for every assessment dimension", () => {
    for (const profile of OPERATING_PROFILES) {
      for (const pillar of PILLARS) {
        pillar.dimensions.forEach((dimension, index) => {
          expect(
            operatingProfileQuestionTips(profile.value, pillar.key, index),
            `${profile.value}: ${pillar.key}/${dimension.key}`,
          ).toHaveLength(1)
        })
      }
    }
  })

  it("keeps workflow examples separated by profile", () => {
    const publicSector = operatingProfileQuestionTips("public_sector", "business_processes_governance", 0).join(" ")
    const manufacturing = operatingProfileQuestionTips("manufacturing", "business_processes_governance", 0).join(" ")

    expect(publicSector).toContain("service request intake")
    expect(manufacturing).toContain("demand planning")
    expect(manufacturing).not.toContain("service request intake")
  })
})
