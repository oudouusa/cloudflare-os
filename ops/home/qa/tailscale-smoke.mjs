import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const playwrightRoot = process.env.CFOS_PLAYWRIGHT_ROOT;
const executablePath = process.env.CFOS_BROWSER_EXECUTABLE;
const privateEnvPath = resolve(process.env.CFOS_PRIVATE_ENV_PATH ?? "ops/home/.env");

function readPublicBaseUrl() {
  for (const rawLine of readFileSync(privateEnvPath, "utf8").split(/\r?\n/)) {
    const match = rawLine.match(/^\s*PUBLIC_BASE_URL\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const value = match[1];
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1);
    }
    return value;
  }
  return undefined;
}

const baseUrl = process.env.CFOS_BROWSER_BASE_URL ?? readPublicBaseUrl();

if (!playwrightRoot) throw new Error("Set CFOS_PLAYWRIGHT_ROOT to a QA package containing Playwright.");
if (!baseUrl) throw new Error("Set CFOS_BROWSER_BASE_URL to the private Tailscale HTTPS origin.");

const require = createRequire(resolve(playwrightRoot, "package.json"));
const { chromium } = require("playwright");
let browser;
try {
  const origin = new URL(baseUrl);
  assert.equal(origin.protocol, "https:", "Tailscale smoke requires HTTPS");
  assert.equal(origin.pathname, "/", "Tailscale smoke requires an origin without a path");

  browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const sockets = [];
  page.on("websocket", socket => sockets.push(new URL(socket.url())));

  let response;
  try {
    response = await page.goto(new URL("/signup", origin).toString(), {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
  } catch {
    throw new Error("tailnet HTTPS navigation failed; URL withheld");
  }
  assert.equal(response?.ok(), true, "tailnet HTTPS route did not load successfully");
  await page.getByText("Signups are closed", { exact: true }).waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1_000);

  const firstSocketCount = sockets.length;
  assert.ok(firstSocketCount > 0, "no WebSocket connection was observed over Tailscale Serve");
  assert.ok(sockets.every(socket =>
    socket.protocol === "wss:" && socket.hostname === origin.hostname),
  "a WebSocket did not use the private HTTPS origin");

  await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.getByText("Signups are closed", { exact: true }).waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1_000);
  assert.ok(sockets.length > firstSocketCount, "reload did not establish a new WebSocket");
  assert.equal(await page.getByText("Can't reach the server. Retrying…").count(), 0,
      "frontend reports a lost connection after reload");

  console.log("PASS tailnet-only HTTPS, WSS, and reload persistence");
} catch {
  console.error("FAIL private tailnet browser smoke; URL and transport details withheld");
  process.exitCode = 1;
} finally {
  await browser?.close();
}
