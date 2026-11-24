import { beforeEach, expect, it, vi } from "vitest";
import * as React from "react";

Object.assign(globalThis, { React });

const mocks = vi.hoisted(() => ({
  tenant: vi.fn(),
  brand: vi.fn(),
  mount: vi.fn((props: Record<string, unknown>) => React.createElement("div", props)),
}));

vi.mock("./host-mount", () => ({ AssessmentMount: mocks.mount }));

import { createAssessmentPage } from "./host-page";
import type { ModuleHostServices } from "@opentenant/database/module-host";
const AssessmentPage = createAssessmentPage({ currentTenant: mocks.tenant, brandForTenant: mocks.brand, serverConfig: () => ({}) } as unknown as ModuleHostServices);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.tenant.mockResolvedValue({ tenantId: "tenant-server" });
  mocks.brand.mockResolvedValue({ displayName: "Synthetic Tenant", logoUrl: "/logo.svg", markUrl: "/mark.svg", exportFilenameSuffix: "synthetic" });
});

it("passes the server-resolved tenant and brand to the Assessment mount", async () => {
  const result = await AssessmentPage();
  expect(mocks.tenant).toHaveBeenCalledExactlyOnceWith();
  expect(mocks.brand).toHaveBeenCalledExactlyOnceWith("tenant-server");
  expect(result.props.tenantId).toBe("tenant-server");
  expect(result.props.brand).toEqual({ displayName: "Synthetic Tenant", logoUrl: "/logo.svg", markUrl: "/mark.svg" });
  expect(result.props.exportSuffix).toBe("synthetic");
});

it("fails closed to the empty server tenant without accepting client state", async () => {
  mocks.tenant.mockResolvedValueOnce(null);
  mocks.brand.mockResolvedValueOnce(null);
  const result = await AssessmentPage();
  expect(mocks.brand).not.toHaveBeenCalled();
  expect(result.props.tenantId).toBe("");
  expect(result.props.brand.displayName).toBe("opentenant");
});
