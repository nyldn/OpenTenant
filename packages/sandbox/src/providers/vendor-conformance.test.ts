import { VercelSandboxAdapter } from "./vercel/adapter";
import type { VercelSandboxInstance } from "./vercel/client";
import { SandboxdAdapter } from "./sandboxd/adapter";
import { SandboxdClient } from "./sandboxd/client";
import { E2bSandboxAdapter } from "./e2b/adapter";
import { MicrosandboxAdapter } from "./microsandbox/adapter";
import { defineSandboxAdapterConformance } from "../testing/conformance";
import { mockE2b, mockMicrosandbox, vendorRequest, vendorTemplates } from "../testing/vendor-fixtures";

defineSandboxAdapterConformance({ name: "e2b mocked SDK", provider: "e2b", createRequest: vendorRequest, createAdapter: () => new E2bSandboxAdapter({ provider: "e2b", apiKey: "synthetic-key", templates: vendorTemplates, sdk: mockE2b().sdk, protectPreview: async () => new URL("https://preview.example.test/preview") }) });
defineSandboxAdapterConformance({ name: "microsandbox mocked SDK", provider: "microsandbox", createRequest: vendorRequest, createAdapter: () => new MicrosandboxAdapter({ provider: "microsandbox", templates: vendorTemplates, sdk: mockMicrosandbox().sdk }) });

defineSandboxAdapterConformance({ name: "vercel mocked transport", provider: "vercel", createRequest: vendorRequest, createAdapter: () => {
  let count = 0;
  const snapshots = new Map<string, Map<string, Uint8Array>>();
  return new VercelSandboxAdapter({ protectPreview: async () => new URL("https://preview.example.test/preview"), client: { create: async (input) => {
    const id = `vercel_${++count}`;
    const files = new Map(input.source ? snapshots.get(input.source.snapshotId) : []);
    const instance: VercelSandboxInstance = { id, writeFiles: async (entries) => { for (const entry of entries) files.set(entry.path, entry.contents); }, runCommand: async () => ({ exitCode: 0, stdout: "abcdefghij", stderr: "" }), updatePorts: async () => undefined, domain: () => "https://upstream.example.test", snapshot: async () => { snapshots.set(id, new Map(files)); return { id }; }, readFile: async (path) => files.get(path)!, stop: async () => undefined };
    return instance;
  } } });
} });

defineSandboxAdapterConformance({ name: "sandboxd mocked HTTP", provider: "sandboxd", createRequest: vendorRequest, createAdapter: () => {
  let count = 0;
  const records = new Map<string, Map<string, Uint8Array>>();
  const snapshots = new Map<string, Map<string, Uint8Array>>();
  const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
  const remote = (id: string) => ({ id, status: "running", created_at: new Date().toISOString(), preview: { url: "https://private.example.test", port: 3000, status: "up" } });
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    if (url.pathname === "/v1/sandboxes") {
      const id = `sandboxd_${++count}`;
      records.set(id, new Map(body.from_snapshot ? snapshots.get(body.from_snapshot) : []));
      return json(remote(id));
    }
    if (url.pathname === "/v1/snapshots") { snapshots.set("snap", new Map(records.get(body.source_sandbox_id))); return json({ id: "snap", name: "before", created_at: new Date().toISOString() }); }
    const id = url.pathname.split("/")[3]!;
    if (url.pathname.endsWith("/files/content")) return new Response(Uint8Array.from(records.get(id)!.get(`workspace/app/${url.searchParams.get("path")}`)!).buffer);
    if (url.pathname.endsWith("/files")) { records.get(id)!.set(url.searchParams.get("path")!, new Uint8Array(init!.body as ArrayBuffer)); return new Response(null); }
    return json(remote(id));
  };
  return new SandboxdAdapter({ client: new SandboxdClient({ baseUrl: "http://127.0.0.1:9999", fetch: fetcher }) });
} });
