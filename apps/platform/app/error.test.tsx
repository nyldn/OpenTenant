import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ErrorBoundary from "./error";
import GlobalError from "./global-error";
describe("secret-free error boundaries", () => {
  it.each([ErrorBoundary, GlobalError])("never renders exception details", (Boundary) => {
    const html = renderToStaticMarkup(<Boundary error={Object.assign(new Error("private"), { digest: "private" })} reset={() => {}} />);
    expect(html).not.toContain("private"); expect(html).toContain("role=\"alert\""); expect(html).toContain("Try again");
  });
});
