import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ModuleScreen from "./page";

describe("tenant module starter", () => {
  it("renders a branded, screen-level starting point", () => {
    const html = renderToStaticMarkup(<ModuleScreen />);
    expect(html).toContain("Tenant module starter");
    expect(html).toContain("Build the screen your tenant needs");
  });
});
