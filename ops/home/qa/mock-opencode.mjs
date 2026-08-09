import { createServer } from "node:http";

const PORT = 4100;
const EXPECTED_AUTH = "Bearer mock-opencode-key";
let chatCompletionRequests = 0;
let compatibilityFailures = 0;

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function chatCompletion(message, finishReason = "stop") {
  return {
    id: "chatcmpl_mock",
    object: "chat.completion",
    created: 1_786_118_400,
    model: "deepseek-v4-flash",
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
  };
}

const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, { status: "ok" });
    return;
  }

  if (request.headers.authorization !== EXPECTED_AUTH) {
    sendJson(response, 401, { error: { message: "invalid mock credential" } });
    return;
  }

  if (request.method === "GET" && request.url === "/qa/stats") {
    sendJson(response, 200, { chatCompletionRequests, compatibilityFailures });
    return;
  }

  if (request.method === "GET" && request.url === "/v1/models") {
    sendJson(response, 200, {
      object: "list",
      data: [{ id: "deepseek-v4-flash", object: "model", created: 1_786_118_400, owned_by: "opencode-go" }],
    });
    return;
  }

  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    sendJson(response, 404, { error: { message: "mock route not found" } });
    return;
  }

  chatCompletionRequests += 1;

  const chunks = [];
  request.on("data", chunk => chunks.push(chunk));
  request.on("end", () => {
    let payload;
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      sendJson(response, 400, { error: { message: "invalid JSON" } });
      return;
    }

    if (payload.model !== "deepseek-v4-flash") {
      sendJson(response, 400, { error: { message: "unexpected model" } });
      return;
    }

    // DeepSeek V4 thinking mode rejects the tool_choice parameter. Keep the
    // mock strict so the bridge QA cannot pass with a payload the real model
    // refuses before inference.
    if (Object.hasOwn(payload, "tool_choice")) {
      compatibilityFailures += 1;
      sendJson(response, 400, {
        error: { message: "thinking mode does not support tool_choice" },
      });
      return;
    }

    const hasToolOutput = payload.messages?.some(message => message.role === "tool");
    if (hasToolOutput) {
      const assistantToolCall = payload.messages?.find(message =>
        message.role === "assistant" && message.tool_calls?.length);
      if (assistantToolCall?.content === null) {
        compatibilityFailures += 1;
        console.error("MOCK_COMPAT_FAIL assistant_tool_call_content_null");
        sendJson(response, 409, {
          error: { message: "assistant tool-call content was null" },
        });
        return;
      }
      if (assistantToolCall?.reasoning_content !== "mock reasoning preserved") {
        compatibilityFailures += 1;
        const category = !assistantToolCall ||
            !Object.hasOwn(assistantToolCall, "reasoning_content")
          ? "missing"
          : assistantToolCall.reasoning_content === null
            ? "null"
            : assistantToolCall.reasoning_content === ""
              ? "empty"
              : "unexpected";
        console.error(`MOCK_COMPAT_FAIL assistant_reasoning_context_${category}`);
        sendJson(response, 422, {
          error: { message: "assistant tool-call reasoning context was not preserved" },
        });
        return;
      }
      sendJson(response, 200, chatCompletion({
        role: "assistant",
        content: "mock tool round-trip complete",
      }));
      return;
    }

    if (payload.tools?.length) {
      sendJson(response, 200, chatCompletion({
        role: "assistant",
        content: "",
        reasoning_content: "mock reasoning preserved",
        tool_calls: [{
          id: "call_mock_write_file",
          type: "function",
          function: {
            name: "write_file",
            arguments: JSON.stringify({ path: "bridge.txt", content: "mock bridge ok" }),
          },
        }],
      }, "tool_calls"));
      return;
    }

    sendJson(response, 200, chatCompletion({
      role: "assistant",
      content: "mock normal response complete",
    }));
  });
});

server.listen(PORT, "0.0.0.0");

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
