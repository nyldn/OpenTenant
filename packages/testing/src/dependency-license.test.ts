import { expect, it } from "vitest";
import { installedPropertyTestDependencyBom, propertyTestDependencyBom } from "../scripts/dependency-proof.mjs";

it("accepts installed MIT property-test dependencies and emits their SBOM", () => {
  const bom = installedPropertyTestDependencyBom();
  expect(bom.bomFormat).toBe("CycloneDX");
  expect(bom.components.map(component => component.name)).toEqual(["fast-check", "pure-rand"]);
  expect(bom.components.every(component => component.licenses[0]?.license.id === "MIT")).toBe(true);
});
it.each(["AGPL-3.0-only", "GPL-3.0-only", "SSPL-1.0", "BUSL-1.1", "UNLICENSED", ""])("rejects a disallowed property-test dependency license %s", license => {
  expect(() => propertyTestDependencyBom([{ name: "fast-check", version: "4.3.0", license }, { name: "pure-rand", version: "7.0.1", license: "MIT" }])).toThrow("unapproved");
});
