import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SuspendedTenantPage } from "./tenant-suspended-page";
describe("suspended tenant page", () => {
  it("renders an explanation without tenant content", () => {
    const html = renderToStaticMarkup(<SuspendedTenantPage />);
    expect(html).toContain("Tenant suspended");
    expect(html).not.toContain("<form");
  });
});
