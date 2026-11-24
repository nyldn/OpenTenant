import { expect, it, vi } from "vitest";
vi.mock("./server-config", () => ({ serverConfig: () => ({ PUBLIC_EXAMPLE: "visible", CONTROL_PLANE_DATABASE_URL: "must-not-leak" }) }));
vi.mock("../opentenant-modules", () => ({ installedModules: { get: (key: string) => key === "example" ? { environmentKeys: ["PUBLIC_EXAMPLE"] } : undefined } }));
import { moduleServicesFor } from "./module-services";
it("projects only declared module configuration and gives unknown modules no configuration", () => {
  expect(moduleServicesFor("example").serverConfig()).toEqual({ PUBLIC_EXAMPLE: "visible" });
  expect(moduleServicesFor("unknown").serverConfig()).toEqual({});
});
