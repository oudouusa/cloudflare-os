import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.argv[2] ?? "ops/home/.env");
const mode = statSync(envPath).mode & 0o777;
if (mode !== 0o600) {
  throw new Error(`Private env must be mode 600; found ${mode.toString(8)}.`);
}

const values = new Map();
for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith("#")) continue;

  const equalsIndex = line.indexOf("=");
  if (equalsIndex < 1) throw new Error("Private env contains a malformed non-comment line.");

  const key = line.slice(0, equalsIndex).trim();
  let value = line.slice(equalsIndex + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  if (values.has(key)) throw new Error(`Private env contains duplicate key ${key}.`);
  values.set(key, value);
}

for (const key of [
  "OPENCODE_GO_API_KEY",
  "LITELLM_MASTER_KEY",
  "OPENCODE_GO_API_BASE",
  "PUBLIC_BASE_URL",
]) {
  if (!values.get(key)) throw new Error(`Private env is missing ${key}.`);
}

for (const key of ["OPENCODE_GO_API_KEY", "LITELLM_MASTER_KEY"]) {
  const value = values.get(key);
  if (value.length < 16 || /replace-me|mock-only|mock-opencode/i.test(value)) {
    throw new Error(`${key} is a placeholder or unexpectedly short.`);
  }
}

if (values.get("OPENCODE_GO_API_BASE") !== "https://opencode.ai/zen/go/v1") {
  throw new Error("OPENCODE_GO_API_BASE does not match the verified OpenCode Go endpoint.");
}

const tailscaleStatus = JSON.parse(execFileSync(
    "tailscale",
    ["status", "--json"],
    { encoding: "utf8" },
));
const dnsName = tailscaleStatus?.Self?.DNSName?.replace(/\.$/, "");
if (!dnsName) throw new Error("Tailscale Self.DNSName is unavailable.");

const expectedPublicBase = `https://${dnsName}`;
if (values.get("PUBLIC_BASE_URL").replace(/\/$/, "") !== expectedPublicBase) {
  throw new Error("PUBLIC_BASE_URL does not match this PC's Tailscale HTTPS origin.");
}

console.log("PASS private env permissions, non-placeholder credentials, provider base, and Tailscale origin");
