import assert from "node:assert/strict";
import { chmod, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const playwrightRoot = process.env.CFOS_PLAYWRIGHT_ROOT;
const executablePath = process.env.CFOS_BROWSER_EXECUTABLE;
const baseUrl = process.env.CFOS_BROWSER_BASE_URL ?? "http://127.0.0.1:18878";
const evidenceDir = resolve(process.env.CFOS_EVIDENCE_DIR ?? "ops/home/evidence/inapp-mock");
const username = process.env.CFOS_MOCK_USERNAME ?? "cfosmockowner";
const password = process.env.CFOS_MOCK_PASSWORD ?? "mock-only-password-2026";
const modelId = "deepseek-v4-flash";
const modelName = "Mock DeepSeek V4 Flash";
const litellmKey = "sk-litellm-mock-only";
const normalPrompt = "CFOS_MOCK_NORMAL deterministic in-app QA";
const normalMarker = "MOCK_NORMAL_COMPLETE: Cloudflare OS streaming chat succeeded.";
const agentPrompt = "CFOS_MOCK_AGENT deterministic in-app agent QA";
const agentMarker = "MOCK_AGENT_COMPLETE: Gadget files created and artifact test passed.";
const verifyWorkspaceUrl = process.env.CFOS_VERIFY_WORKSPACE_URL;

if (!playwrightRoot) {
  throw new Error("Set CFOS_PLAYWRIGHT_ROOT to a QA package containing Playwright.");
}
const parsedBaseUrl = new URL(baseUrl);
assert.equal(parsedBaseUrl.hostname, "127.0.0.1", "mock QA must target IPv4 loopback");
assert.notEqual(parsedBaseUrl.port, "8877", "mock QA must not target the live Cloudflare OS port");
assert.equal(process.env.CFOS_CONFIRM_ISOLATED_MOCK, "yes", "set CFOS_CONFIRM_ISOLATED_MOCK=yes");

const require = createRequire(resolve(playwrightRoot, "package.json"));
const { chromium } = require("playwright");
await mkdir(evidenceDir, { recursive: true, mode: 0o700 });

const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
page.on("pageerror", error => console.error(`[browser:pageerror] ${error.message}`));

function safeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "http:" || url.protocol === "https:"
      ? `${url.origin}${url.pathname}`
      : url.protocol;
  } catch {
    return "<invalid-url>";
  }
}

page.on("requestfailed", request => {
  console.error(
    `[browser:requestfailed] ${request.method()} ${safeUrl(request.url())} ` +
    `${request.failure()?.errorText ?? "unknown"}`,
  );
});
page.on("response", response => {
  if (response.status() >= 400) {
    console.error(
      `[browser:response] ${response.status()} ${response.request().method()} ` +
      `${safeUrl(response.url())}`,
    );
  }
});

async function screenshot(name) {
  const path = resolve(evidenceDir, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await chmod(path, 0o600);
}

async function bodyText() {
  return page.locator("body").innerText();
}

async function signUpOrSignIn() {
  const response = await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  assert.equal(response?.ok(), true, "Cloudflare OS navigation failed");
  await page.waitForTimeout(1_000);

  const signInButton = page.getByRole("button", { name: "Sign in", exact: true });
  if (await signInButton.isVisible().catch(() => false)) {
    await page.getByRole("textbox", { name: "Username", exact: true }).fill(username);
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await signInButton.click();
    const loginOutcome = await page.waitForFunction(() => {
      if (localStorage.getItem("authToken")) return "signed-in";
      if (document.body.innerText.includes("Invalid username or password")) return "invalid";
      return null;
    }, { timeout: 30_000 }).then(handle => handle.jsonValue());
    if (loginOutcome === "signed-in") {
      return "signin";
    }

    const createAccountLink = page.getByRole("link", { name: "Create one", exact: true });
    await createAccountLink.click();
    await page.getByRole("textbox", { name: "Username", exact: true }).fill(username);
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByRole("textbox", { name: "Confirm Password", exact: true }).fill(password);
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await page.waitForFunction(() => {
      const text = document.body.innerText;
      return text.includes("Let's set you up") || text.includes("Start a new conversation");
    }, { timeout: 30_000 });
    return "signup";
  }
  return "session";
}

async function configureOnboarding() {
  if (!(await bodyText()).includes("Let's set you up")) return false;

  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Add new model...", exact: true }).waitFor();
  await page.getByRole("button", { name: "Add new model...", exact: true }).click();

  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox").click();
  await page.getByRole("option", { name: "Other OpenAI...", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Model ID", exact: true }).fill(modelId);
  await dialog.getByRole("textbox", { name: "Display Name", exact: true }).fill(modelName);
  await dialog.getByRole("textbox", { name: "API Token", exact: true }).fill(litellmKey);
  await dialog.getByText("Advanced Settings", { exact: true }).click();
  await dialog.getByRole("textbox", { name: "API URL", exact: true }).fill("http://litellm:4000/v1");
  await screenshot("01-model-form");
  await dialog.getByRole("button", { name: "Add Model", exact: true }).click();

  const modelButton = page.getByRole("button", { name: new RegExp(modelName) });
  await modelButton.waitFor({ state: "visible", timeout: 30_000 });
  await modelButton.click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Let's build", exact: true }).click();
  await page.locator('textarea[placeholder="Start a new conversation…"]').waitFor({
    state: "visible",
    timeout: 30_000,
  });
  return true;
}

async function openNewConversation() {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  const composer = page.locator('textarea[placeholder="Start a new conversation…"]');
  await composer.waitFor({ state: "visible", timeout: 30_000 });
  const modelPicker = page.getByRole("button", { name: "Select model", exact: true });
  if ((await modelPicker.innerText()).includes("No agent")) {
    await modelPicker.click();
    await page.getByRole("menuitem").filter({ hasText: modelName }).click();
    await assert.doesNotReject(async () => {
      await page.getByRole("button", { name: "Select model", exact: true })
        .filter({ hasText: modelName }).waitFor({ state: "visible", timeout: 10_000 });
    });
  }
  return composer;
}

async function sendNewConversation(prompt, marker, timeout) {
  const composer = await openNewConversation();
  await composer.fill(prompt);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByText(marker, { exact: false }).last().waitFor({ state: "visible", timeout });
  assert.match(page.url(), /\/workspace\//, "conversation did not receive a durable workspace route");
  return page.url();
}

async function sendFollowUp(prompt, marker, timeout) {
  const composer = page.locator('textarea[placeholder="Ask a follow-up…"]');
  await composer.waitFor({ state: "visible", timeout: 30_000 });
  await composer.fill(prompt);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByText(marker, { exact: false }).last().waitFor({ state: "visible", timeout });
  return page.url();
}

async function assertRenderedGadget() {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      const text = await frame.locator("body").innerText().catch(() => "");
      if (text.includes("2 + 2 = 4")) return;
    }
    await page.waitForTimeout(500);
  }
  const frameUrls = page.frames().map(frame => safeUrl(frame.url()));
  throw new Error(
    `Gadget iframe never rendered the tested 2 + 2 = 4 artifact; frames=${JSON.stringify(frameUrls)}`,
  );
}

async function assertAgentEvidence() {
  const text = await bodyText();
  assert.match(text, /Mock Agent Proof/);
  assert.match(text, /(New app · Click to preview|App · Click to open)/);
  assert.match(text, /Wrote\s+server\.js/);
  assert.match(text, /Wrote\s+client\.js/);
  assert.match(text, /Ran code/);
  if (page.frames().length === 1) {
    await page.getByText(/^(New app · Click to preview|App · Click to open)$/).click();
  }
  await assertRenderedGadget();
}

try {
  const authMode = await signUpOrSignIn();
  const onboarded = await configureOnboarding();
  await screenshot("02-ready");

  if (verifyWorkspaceUrl) {
    const parsedWorkspaceUrl = new URL(verifyWorkspaceUrl);
    assert.equal(parsedWorkspaceUrl.origin, parsedBaseUrl.origin,
      "verification workspace must use the isolated mock origin");
    assert.match(parsedWorkspaceUrl.pathname, /^\/workspace\//,
      "verification target must be a workspace URL");
    await page.goto(parsedWorkspaceUrl.href, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.getByText(agentMarker, { exact: false }).last().waitFor({ timeout: 90_000 });
    await assertAgentEvidence();
    await screenshot("08-post-restart-persistence");
    console.log(JSON.stringify({
      status: "PASS",
      authMode,
      onboarded,
      verifiedWorkspaceUrl: parsedWorkspaceUrl.href,
      assertions: [
        "account login after container restart",
        "agent chat history after container restart",
        "tool evidence after container restart",
        "rendered Gadget artifact after container restart",
      ],
    }, null, 2));
  } else {
    const normalUrl = await sendNewConversation(normalPrompt, normalMarker, 90_000);
    await screenshot("03-normal-chat");
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.getByText(normalMarker, { exact: false }).last().waitFor({ timeout: 90_000 });
    await screenshot("04-normal-reload");

    const agentUrl = await sendFollowUp(agentPrompt, agentMarker, 180_000);
    await assertAgentEvidence();
    await screenshot("05-agent-tools-and-gadget");

    const acceptChanges = page.getByRole("button", { name: "Accept changes", exact: true });
    if (await acceptChanges.isVisible().catch(() => false)) {
      await acceptChanges.click();
      await acceptChanges.waitFor({ state: "hidden", timeout: 30_000 });
    }
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.getByText(agentMarker, { exact: false }).last().waitFor({ timeout: 90_000 });
    await assertAgentEvidence();
    await screenshot("06-agent-reload");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.getByText(agentMarker, { exact: false }).last().waitFor({ timeout: 90_000 });
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `mobile view has ${overflow}px horizontal overflow`);
    await screenshot("07-mobile-agent-reload");

    console.log(JSON.stringify({
      status: "PASS",
      authMode,
      onboarded,
      normalUrl,
      agentUrl,
      assertions: [
        "streaming normal chat",
        "normal chat reload persistence",
        "createGadget tool evidence",
        "writeFile server.js and client.js evidence",
        "executeCode evidence",
        "rendered Gadget artifact",
        "agent chat and Gadget reload persistence",
        "mobile no-horizontal-overflow",
      ],
    }, null, 2));
  }
} finally {
  await context.close();
  await browser.close();
}
