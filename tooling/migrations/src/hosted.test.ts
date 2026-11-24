import { describe, expect, it, vi } from "vitest";
// @ts-expect-error Node CLI entrypoint
import { runHosted } from "./hosted.mjs";
describe("hosted migration safety", () => {
  it.each([{ args: [] }, { args: ["--target", "other.example.test"] }])("requires exact target confirmation before connecting", async ({ args }) => {
    const connect = vi.fn();
    await expect(runHosted({ args: ["control-plane", ...args], env: { CONTROL_PLANE_DATABASE_URL: "postgresql://user:synthetic@db.example.test/control" }, poolFactory: connect }))
      .rejects.toThrow("target");
    expect(connect).not.toHaveBeenCalled();
  });
  it("rejects query-string connection overrides before connecting", async () => {
    const poolFactory = vi.fn();
    await expect(runHosted({ args: ["control-plane", "--target", "db.example.test"], env: {
      CONTROL_PLANE_DATABASE_URL: "postgresql://db.example.test/control?host=other.example.test",
    }, poolFactory })).rejects.toThrow("connection options");
    expect(poolFactory).not.toHaveBeenCalled();
  });
  it("rejects unknown flags and invalid URLs without echoing values", async () => {
    await expect(runHosted({ args: ["control-plane", "--force"] })).rejects.toThrow("arguments");
    await expect(runHosted({ args: ["control-plane", "--target", "db.example.test"], env: { CONTROL_PLANE_DATABASE_URL: "credential-secret" } })).rejects.toThrow("Invalid database URL");
  });
});
