import { buildConfig } from "./lib/server-config";
import type { NextConfig } from "next";

import path from "node:path";

// Reject before compilation as well as at runtime in server-config.ts.
if (buildConfig().NODE_ENV === "production" && buildConfig().OPENTENANT_E2E !== undefined) {
  throw new Error("Invalid server configuration: OPENTENANT_E2E");
}

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Runtime instrumentation must load the original Node modules so pg hooks attach.
  serverExternalPackages: [
    // Preserve import.meta.url so Node reads the shipped SQL assets directly.
    "@opentenant/migrations",
    "@opentelemetry/sdk-node", "@opentelemetry/exporter-trace-otlp-http",
    "@opentelemetry/instrumentation-pg", "@vercel/otel", "@sentry/nextjs", "pino",
  ],
  async headers() {
    // Module proxy responses (/m/...) set their own sandbox CSP, including
    // frame-ancestors. A config-level CSP here would replace that sandbox.
    return [{
      source: "/:path((?!m(?:/|$)|api/mcp/developer(?:/|$)|api/auth/better-auth(?:/|$)).*)",
      headers: [
        { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
      ],
    }];
  },
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  webpack(config, { webpack }) {
    if (buildConfig().OPENTENANT_E2E === "1") {
      // Replace composition roots only. Test controls never become app routes.
      for (const [pattern, replacement] of [
        [/apps\/platform\/app\/api\/settings\/domains\/route\.ts$/u, "domain-route.ts"],
      ] as const) {
        const target = path.join(import.meta.dirname, "../../tooling/e2e", replacement);
        config.plugins.push(new webpack.NormalModuleReplacementPlugin(pattern, (resource: {
          request: string; createData?: { resource: string; context: string };
        }) => {
          if (resource.createData) {
            resource.createData.resource = target;
            resource.createData.context = path.dirname(target);
          } else resource.request = target;
        }));
      }
    }
    return config;
  },
};

export default nextConfig;
