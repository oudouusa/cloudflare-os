import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const playwrightRoot = process.env.CFOS_PLAYWRIGHT_ROOT;
const executablePath = process.env.CFOS_BROWSER_EXECUTABLE;
const baseUrl = process.env.CFOS_BROWSER_BASE_URL ?? "http://127.0.0.1:8877";
if (!playwrightRoot) throw new Error("Set CFOS_PLAYWRIGHT_ROOT to a QA package containing Playwright.");

const require = createRequire(resolve(playwrightRoot, "package.json"));
const { chromium } = require("playwright");
const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
});

try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const signupUrl = new URL("/signup", baseUrl);
  const response = await page.goto(signupUrl.toString(), {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  assert.equal(response?.ok(), true, "signup route did not load successfully");
  await page.waitForTimeout(1_500);

  const bodyText = await page.locator("body").innerText();
  assert.match(
      bodyText,
      /Signups are closed|New account registration is currently disabled/i,
      "new account registration is still open",
  );
  console.log("PASS unauthenticated signup route reports registration closed");
} finally {
  await browser.close();
}
