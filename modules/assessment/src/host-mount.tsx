"use client";

import { listenBrowserEvent } from "@opentenant/platform-core/runtime-globals";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import {
  ASSESSMENT_SIGN_OUT_EVENT,
  configureAssessmentRuntime,
  type AssessmentRuntimeBrand,
} from "./runtime";

// Assessment reads localStorage during initial render; ssr:false keeps the module
// out of server rendering entirely.
const AssessmentSurface = dynamic(() => import("./AssessmentSurface"), { ssr: false });

export function AssessmentMount({
  tenantId,
  brand,
  exportSuffix,
}: {
  tenantId: string;
  brand: AssessmentRuntimeBrand;
  exportSuffix?: string;
}) {
  // Configure before the dynamically imported surface evaluates; render is
  // gated on the effect having run via the key below being stable.
  configureAssessmentRuntime({
    readoutEndpoint: "/api/assessment-readout",
    tenantId,
    exportSuffix: exportSuffix ?? "assessment",
    brand,
  });

  useEffect(() => {
    // Content-free page view (spec 13); fire-and-forget.
    void fetch("/api/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "assessment.page.viewed",
        tenantId: null,
        moduleKey: "assessment",
        moduleVersion: "1.0.0",
        occurredAt: new Date().toISOString(),
        properties: {},
      }),
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    // Assessment's sign-out control ends the platform session.
    const onSignOut = () => {
      const form = document.createElement("form");
      form.method = "POST";
      form.action = "/auth/logout";
      document.body.appendChild(form);
      form.submit();
    };
    return listenBrowserEvent(ASSESSMENT_SIGN_OUT_EVENT, onSignOut);
  }, []);

  return <AssessmentSurface key={tenantId} />;
}
