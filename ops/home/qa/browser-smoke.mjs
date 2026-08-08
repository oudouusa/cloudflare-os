import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { chmod, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const playwrightRoot = process.env.CFOS_PLAYWRIGHT_ROOT;
const executablePath = process.env.CFOS_BROWSER_EXECUTABLE;
const baseUrl = process.env.CFOS_BROWSER_BASE_URL ?? "http://127.0.0.1:8877";
const evidenceDir = resolve(process.env.CFOS_EVIDENCE_DIR ?? "ops/home/evidence/browser-smoke");

if (!playwrightRoot) throw new Error("Set CFOS_PLAYWRIGHT_ROOT to a QA package containing Playwright.");

const require = createRequire(resolve(playwrightRoot, "package.json"));
const { chromium } = require("playwright");
await mkdir(evidenceDir, { recursive: true, mode: 0o700 });

const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
});
try {
  for (const viewport of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const response = await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    assert.equal(response?.ok(), true, `${viewport.name} navigation failed`);
    await page.waitForTimeout(2_000);

    const bodyText = await page.locator("body").innerText();
    assert.match(bodyText, /Sign in|Create account|What are we working on\?|Let's set you up/);
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `${viewport.name} has ${overflow}px horizontal overflow`);

    const screenshotPath = resolve(evidenceDir, `${viewport.name}.png`);
    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
    });
    await chmod(screenshotPath, 0o600);
    await context.close();
    console.log(`PASS ${viewport.name} ${viewport.width}x${viewport.height} basic layout`);
  }
} finally {
  await browser.close();
}
