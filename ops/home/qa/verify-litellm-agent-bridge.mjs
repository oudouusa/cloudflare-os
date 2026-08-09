import assert from "node:assert/strict";

const baseUrl = process.env.QA_LITELLM_BASE_URL ?? "http://127.0.0.1:14002/v1";
const masterKey = process.env.QA_LITELLM_MASTER_KEY ?? "sk-litellm-mock-only";
const mockBaseUrl = process.env.QA_MOCK_BASE_URL ?? "http://127.0.0.1:14100";
const mockApiKey = process.env.QA_MOCK_API_KEY ?? "mock-opencode-key";

const tools = [
  {
    type: "function",
    name: "createGadget",
    description: "Create a new Gadget.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        bindingName: { type: "string" },
      },
      required: ["title", "bindingName"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "writeFile",
    description: "Write a Gadget file.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        workpiece: { type: "string" },
        filename: { type: "string" },
        content: { type: "string" },
      },
      required: ["workpiece", "filename", "content"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "executeCode",
    description: "Execute a test module.",
    strict: true,
    parameters: {
      type: "object",
      properties: { code: { type: "string" } },
      required: ["code"],
      additionalProperties: false,
    },
  },
];

async function stats() {
  const response = await fetch(`${mockBaseUrl}/qa/stats`, {
    headers: { authorization: `Bearer ${mockApiKey}` },
  });
  assert.equal(response.ok, true, `mock stats failed with HTTP ${response.status}`);
  return response.json();
}

async function streamedResponse(input) {
  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${masterKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-v4-flash",
      input,
      tools,
      stream: true,
    }),
  });
  assert.equal(response.ok, true, `streamed /responses failed with HTTP ${response.status}`);
  const body = await response.text();
  const events = body
    .split(/\n\n/)
    .flatMap(block => block.split(/\n/))
    .filter(line => line.startsWith("data: "))
    .map(line => line.slice(6))
    .filter(data => data !== "[DONE]")
    .map(data => JSON.parse(data));
  const completed = events.find(event => event.type === "response.completed");
  assert.equal(completed?.response?.status, "completed");
  return completed.response;
}

const before = await stats();
const userMessage = {
  role: "user",
  content: [{ type: "input_text", text: "CFOS_MOCK_AGENT deterministic agent bridge QA" }],
};
const history = [];
const expectedCalls = ["createGadget", "writeFile", "writeFile", "executeCode"];
const expectedFiles = [undefined, "server.js", "client.js", undefined];

for (let index = 0; index < expectedCalls.length; index += 1) {
  const response = await streamedResponse([userMessage, ...history]);
  const reasoning = response.output.filter(item => item.type === "reasoning");
  const calls = response.output.filter(item => item.type === "function_call");
  assert.equal(reasoning.length, 1, `turn ${index + 1} reasoning item count`);
  assert.equal(calls.length, 1, `turn ${index + 1} function call count`);
  assert.equal(calls[0].name, expectedCalls[index]);
  const args = JSON.parse(calls[0].arguments);
  if (expectedFiles[index]) assert.equal(args.filename, expectedFiles[index]);
  history.push(...reasoning, ...calls, {
    type: "function_call_output",
    call_id: calls[0].call_id,
    output: JSON.stringify({ success: true, turn: index + 1 }),
  });
}

const finalResponse = await streamedResponse([userMessage, ...history]);
const finalText = finalResponse.output
  .flatMap(item => item.content ?? [])
  .find(item => item.type === "output_text")?.text;
assert.equal(finalText, "MOCK_AGENT_COMPLETE: Gadget files created and artifact test passed.");

const after = await stats();
assert.equal(after.chatCompletionRequests - before.chatCompletionRequests, 5);
assert.equal(after.compatibilityFailures - before.compatibilityFailures, 0);
console.log(
    "PASS five-turn streaming agent bridge preserved reasoning and emitted " +
    "createGadget, writeFile x2, executeCode, then final text",
);
