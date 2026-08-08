import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.argv[2] ?? "ops/home/.env");
const mode = statSync(envPath).mode & 0o777;
if (mode !== 0o600) {
  throw new Error(`Private env must be mode 600; found ${mode.toString(8)}.`);
}

let tailscaleStatus;
try {
  tailscaleStatus = JSON.parse(execFileSync(
      "tailscale",
      ["status", "--json"],
      { encoding: "utf8" },
  ));
} catch {
  throw new Error("Unable to read local Tailscale status; private output withheld.");
}
const dnsName = tailscaleStatus?.Self?.DNSName?.replace(/\.$/, "");
if (!dnsName || !dnsName.endsWith(".ts.net")) {
  throw new Error("Tailscale Self.DNSName is unavailable or is not a tailnet DNS name.");
}

const original = readFileSync(envPath, "utf8");
let matches = 0;
const updated = original.split(/\r?\n/).map((line) => {
  if (!/^\s*PUBLIC_BASE_URL\s*=/.test(line)) return line;
  matches++;
  return `PUBLIC_BASE_URL=https://${dnsName}`;
}).join("\n");

if (matches !== 1) {
  throw new Error(`Expected one PUBLIC_BASE_URL entry; found ${matches}.`);
}

const temporaryPath = `${envPath}.tmp-${process.pid}`;
try {
  writeFileSync(temporaryPath, updated, { encoding: "utf8", flag: "wx", mode: 0o600 });
  chmodSync(temporaryPath, 0o600);
  renameSync(temporaryPath, envPath);
} finally {
  if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
}

console.log("PASS updated PUBLIC_BASE_URL from local Tailscale status without printing it");
