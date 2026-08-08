import { createServer } from "node:http";

const PORT = 4100;
const EXPECTED_AUTH = "Bearer mock-opencode-key";

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

    const hasToolOutput = payload.messages?.some(message => message.role === "tool");
    if (hasToolOutput) {
      sendJson(response, 200, chatCompletion({
        role: "assistant",
        content: "mock tool round-trip complete",
      }));
      return;
    }

    if (payload.tools?.length) {
      sendJson(response, 200, chatCompletion({
        role: "assistant",
        content: null,
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
