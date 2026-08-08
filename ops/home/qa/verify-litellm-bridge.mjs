import assert from "node:assert/strict";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:4001/v1";
const masterKey = process.env.QA_LITELLM_MASTER_KEY ?? "sk-litellm-mock-only";

async function request(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${masterKey}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  const body = await response.json();
  assert.equal(response.ok, true, `${path} failed with HTTP ${response.status}`);
  return body;
}

const models = await request("/models");
assert.deepEqual(models.data.map(model => model.id), ["glm-5.2"]);
console.log("PASS authenticated model catalog contains only glm-5.2");

const normal = await request("/responses", {
  method: "POST",
  body: JSON.stringify({ model: "glm-5.2", input: "Reply with one short sentence." }),
});
const normalText = normal.output
    .flatMap(item => item.content ?? [])
    .find(item => item.type === "output_text")?.text;
assert.equal(normalText, "mock normal response complete");
console.log("PASS Responses API normal request crossed the Chat Completions bridge");

const toolResponse = await request("/responses", {
  method: "POST",
  body: JSON.stringify({
    model: "glm-5.2",
    input: "Use write_file exactly once.",
    tool_choice: "required",
    tools: [{
      type: "function",
      name: "write_file",
      description: "Write a UTF-8 text file.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
    }],
  }),
});
const toolCall = toolResponse.output.find(item => item.type === "function_call");
assert.equal(toolCall.name, "write_file");
assert.deepEqual(JSON.parse(toolCall.arguments), {
  path: "bridge.txt",
  content: "mock bridge ok",
});
console.log("PASS Responses API function tool became a Chat Completions tool call");

const toolResult = await request("/responses", {
  method: "POST",
  body: JSON.stringify({
    model: "glm-5.2",
    input: [
      toolCall,
      {
        type: "function_call_output",
        call_id: toolCall.call_id,
        output: "mock file written",
      },
    ],
  }),
});
const resultText = toolResult.output
    .flatMap(item => item.content ?? [])
    .find(item => item.type === "output_text")?.text;
assert.equal(resultText, "mock tool round-trip complete");
console.log("PASS function output completed the Responses API tool round-trip");
