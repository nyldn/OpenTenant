import { execFileSync } from "node:child_process";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const label = "com.opentenant.archify.update";
const launchAgentsDirectory = resolve(os.homedir(), "Library/LaunchAgents");
const logDirectory = resolve(os.homedir(), "Library/Logs/OpenTenant");
const plistPath = resolve(launchAgentsDirectory, `${label}.plist`);
const updateScript = resolve(repositoryRoot, "scripts/update-archify.mjs");
const uid = String(process.getuid?.() ?? "");
const domain = `gui/${uid}`;
const service = `${domain}/${label}`;
const fnmPath = execFileSync("/usr/bin/which", ["fnm"], { encoding: "utf8" }).trim();

function xml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function runLaunchctl(args, allowFailure = false) {
  try {
    return execFileSync("/bin/launchctl", args, { encoding: "utf8", stdio: "pipe" });
  } catch (error) {
    if (allowFailure) return "";
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`launchctl ${args.join(" ")} failed: ${detail}`);
  }
}

if (!uid) throw new Error("could not determine the current macOS user ID");

if (process.argv.includes("--remove")) {
  runLaunchctl(["bootout", service], true);
  try {
    unlinkSync(plistPath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  console.log(`Removed ${service}`);
  process.exit(0);
}

mkdirSync(launchAgentsDirectory, { recursive: true });
mkdirSync(logDirectory, { recursive: true });

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(fnmPath)}</string>
    <string>exec</string>
    <string>--using=22</string>
    <string>--</string>
    <string>node</string>
    <string>${xml(updateScript)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(repositoryRoot)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${xml(os.homedir())}</string>
    <key>PATH</key>
    <string>${xml(`${dirname(process.execPath)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>604800</integer>
  <key>ThrottleInterval</key>
  <integer>3600</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xml(resolve(logDirectory, "archify-update.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${xml(resolve(logDirectory, "archify-update.error.log"))}</string>
</dict>
</plist>
`;

writeFileSync(plistPath, plist, { encoding: "utf8", mode: 0o600 });
execFileSync("/usr/bin/plutil", ["-lint", plistPath], { stdio: "inherit" });
runLaunchctl(["bootout", service], true);
runLaunchctl(["bootstrap", domain, plistPath]);

console.log(`Installed ${service}`);
console.log(`Schedule: at login and every 7 days`);
console.log(`Logs: ${logDirectory}`);
console.log(`Run now: pnpm archify:update`);
