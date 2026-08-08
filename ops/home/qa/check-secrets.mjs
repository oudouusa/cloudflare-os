import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import { readFileSync, statSync } from "node:fs";

const root = new URL("../../..", import.meta.url).pathname;
const output = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: root },
);
const paths = output.toString("utf8").split("\0").filter(Boolean);
const failures = new Set();

const secretFilenames = /^(?:\.env|\.dev\.vars)(?:\..+)?$|^(?:id_rsa|id_ed25519|credentials\.json)$/;
const credentialMarkers = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[opusr]_[A-Za-z0-9]{30,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bsk-(?!litellm-(?:replace-me|mock-only))[A-Za-z0-9_-]{24,}\b/,
];

for (const path of paths) {
  const name = basename(path);
  if (secretFilenames.test(name) && name !== ".env.example") {
    failures.add(path);
    continue;
  }

  const fullPath = `${root}/${path}`;
  if (!statSync(fullPath).isFile() || statSync(fullPath).size > 5_000_000) continue;
  const content = readFileSync(fullPath, "utf8");
  if (credentialMarkers.some(pattern => pattern.test(content))) failures.add(path);

  for (const match of content.matchAll(/^(OPENCODE_GO_API_KEY|LITELLM_MASTER_KEY)=(.+)$/gm)) {
    const value = match[2].trim();
    if (!/(?:replace-me|mock-|os\.environ|\$\{|<)/.test(value)) failures.add(path);
  }
}

if (failures.size) {
  console.error("FAIL possible secret material in candidate files:");
  for (const path of [...failures].toSorted()) console.error(`- ${path}`);
  process.exit(1);
}

console.log(`PASS no secret material detected in ${paths.length} candidate files`);
