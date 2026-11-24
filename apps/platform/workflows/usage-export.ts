import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { FileUsageExportSink, OpenMeterUsageExportSink, type UsageExportSink } from "@opentenant/usage-export";
import { serverConfig, type ServerConfig } from "../lib/server-config";

/** Stable destination identities keep receipts from suppressing a new destination. */
export function configuredUsageExportSink(config: ServerConfig = serverConfig()): UsageExportSink {
  const kind = config.USAGE_EXPORT_SINK ?? (config.OPENMETER_INGEST_URL && config.OPENMETER_API_KEY ? "openmeter" : "file");
  if (kind === "file") {
    const directory = resolve(config.USAGE_EXPORT_DIRECTORY ?? join(homedir(), ".local/share/opentenant/usage-export"));
    const id = createHash("sha256").update(directory).digest("hex");
    return new FileUsageExportSink(`files-${id}`, directory);
  }
  if (kind !== "openmeter" || !config.OPENMETER_INGEST_URL || !config.OPENMETER_API_KEY) throw new Error("Invalid usage export configuration");
  const id = createHash("sha256").update(config.OPENMETER_INGEST_URL).digest("hex");
  return new OpenMeterUsageExportSink({ id: `openmeter-${id}`, endpoint: config.OPENMETER_INGEST_URL, apiKey: config.OPENMETER_API_KEY });
}
