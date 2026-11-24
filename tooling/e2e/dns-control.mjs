import { createServer } from "node:http";

export function dnsControl() {
  /** @type {Map<string, string[][]>} */
  const answers = new Map();
  return createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    // A loopback listener alone does not stop hostile browser origins or DNS rebinding.
    if (req.socket.remoteAddress !== "127.0.0.1" || req.headers.origin
      || req.headers.host !== `127.0.0.1:${res.socket.localPort}`) {
      res.writeHead(403).end();
      return;
    }
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname !== "/__e2e/dns") { res.writeHead(404).end(); return; }
    res.setHeader("Content-Type", "application/json");
    if (req.method === "GET") {
      res.end(JSON.stringify(answers.get(url.searchParams.get("record")) ?? []));
      return;
    }
    if (req.method !== "POST") { res.writeHead(405).end(); return; }
    try {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 8192) { res.writeHead(413).end(); return; }
      }
      const { record, records } = JSON.parse(body);
      if (typeof record !== "string" || !/^_opentenant-challenge\.[a-z0-9.-]{1,253}$/u.test(record)
        || !Array.isArray(records) || records.length > 16
        || !records.every((chunks) => Array.isArray(chunks) && chunks.length <= 16
          && chunks.every((value) => typeof value === "string" && value.length <= 1024))) {
        res.writeHead(400).end();
        return;
      }
      answers.set(record, records);
      res.end("{}");
    } catch { res.writeHead(400).end(); }
  });
}
