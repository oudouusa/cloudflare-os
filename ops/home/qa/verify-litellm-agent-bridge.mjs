import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const piSharedUrl = pathToFileURL(
  resolve(
    "packages/workshop-backend/node_modules/@earendil-works/pi-ai/" +
    "dist/api/openai-responses-shared.js",
  ),
);
const { processResponsesStream } = await import(piSharedUrl.href);

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

async function parseWithProductionPi(events) {
  const output = {
    role: "assistant",
    content: [],
    api: "openai-responses",
    provider: "openai",
    model: "deepseek-v4-flash",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
  const model = {
    id: "deepseek-v4-flash",
    name: "Mock DeepSeek V4 Flash",
    api: "openai-responses",
    provider: "openai",
    baseUrl: baseUrl,
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 131_072,
    maxTokens: 8_192,
  };
  const emitted = [];
  async function* eventStream() {
    yield* events;
  }
  await processResponsesStream(eventStream(), output, { push: event => emitted.push(event) }, model);
  return output;
}

async function streamedResponse(input, availableTools = tools, verifyPiSingleText = false) {
  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${masterKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-v4-flash",
      input,
      tools: availableTools,
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
  const reasoningAdded = events.filter(event =>
    event.type === "response.output_item.added" && event.item?.type === "reasoning");
  const reasoningDone = events.filter(event =>
    event.type === "response.output_item.done" && event.item?.type === "reasoning");
  const eventShape = events.map(event => `${event.type}:${event.item?.type ?? "-"}`).join(",");
  const activeItemsByIndex = new Map();
  for (const event of events) {
    if (event.type === "response.output_item.added") {
      assert.equal(
        activeItemsByIndex.has(event.output_index),
        false,
        `output_index ${event.output_index} reused before its item completed; events=${eventShape}`,
      );
      activeItemsByIndex.set(event.output_index, {
        id: event.item?.id,
        type: event.item?.type,
      });
    } else if (event.type === "response.output_item.done") {
      const active = activeItemsByIndex.get(event.output_index);
      if (!active) {
        const emptyTerminalMessage = event.item?.type === "message" &&
          (event.item.content ?? []).every(part => !part.text);
        assert.equal(
          emptyTerminalMessage,
          true,
          `output_index ${event.output_index} completed without a matching added event; events=${eventShape}`,
        );
        continue;
      }
      assert.deepEqual(
        { id: event.item?.id, type: event.item?.type },
        active,
        `output_index ${event.output_index} completed a different item; events=${eventShape}`,
      );
      activeItemsByIndex.delete(event.output_index);
    }
  }
  assert.equal(
    activeItemsByIndex.size,
    0,
    `stream ended with unfinished output items; events=${eventShape}`,
  );
  const expectedReasoningEvents = completed.response.output.some(item => item.type === "reasoning")
    ? 1
    : 0;
  assert.equal(
    reasoningAdded.length,
    expectedReasoningEvents,
    `stream reasoning item added event count; events=${eventShape}`,
  );
  assert.equal(
    reasoningDone.length,
    expectedReasoningEvents,
    `stream reasoning item done event count; events=${eventShape}`,
  );
  if (verifyPiSingleText) {
    const parsed = await parseWithProductionPi(events);
    const parsedText = parsed.content.filter(block => block.type === "text").map(block => block.text);
    const responseText = completed.response.output
      .filter(item => item.type === "message")
      .flatMap(item => item.content ?? [])
      .filter(item => item.type === "output_text")
      .map(item => item.text);
    assert.deepEqual(parsedText, responseText, "production pi parser must emit final text exactly once");
    assert.equal(
      parsed.content.filter(block => block.type === "thinking").length,
      expectedReasoningEvents,
      "production pi parser reasoning block count",
    );
  }
  return completed.response;
}

const before = await stats();
const lateReasoningResponse = await streamedResponse(
  "CFOS_MOCK_LATE_REASONING deterministic late-reasoning QA",
  [],
  true,
);
assert.equal(
  lateReasoningResponse.output.filter(item => item.type === "reasoning").length,
  1,
  "late-reasoning response reasoning item count",
);
assert.equal(
  lateReasoningResponse.output
    .filter(item => item.type === "message")
    .flatMap(item => item.content ?? [])
    .filter(item => item.type === "output_text").map(item => item.text).join(""),
  "MOCK_LATE_REASONING_COMPLETE",
  "late-reasoning response text must not be duplicated",
);
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
assert.equal(after.chatCompletionRequests - before.chatCompletionRequests, 6);
assert.equal(after.compatibilityFailures - before.compatibilityFailures, 0);
console.log(
    "PASS late-reasoning text was singular and five-turn agent bridge preserved reasoning, " +
    "then emitted createGadget, writeFile x2, executeCode, and final text",
);
