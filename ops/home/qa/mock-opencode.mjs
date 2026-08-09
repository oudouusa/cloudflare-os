import { createServer } from "node:http";

const PORT = 4100;
const EXPECTED_AUTH = "Bearer mock-opencode-key";
let chatCompletionRequests = 0;
let compatibilityFailures = 0;
const REASONING = "mock reasoning preserved";

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

function sendCompletion(response, payload, message, finishReason = "stop") {
  if (!payload.stream) {
    sendJson(response, 200, chatCompletion(message, finishReason));
    return;
  }

  const delta = structuredClone(message);
  if (Array.isArray(delta.tool_calls)) {
    delta.tool_calls = delta.tool_calls.map((toolCall, index) => ({ index, ...toolCall }));
  }
  const base = {
    id: "chatcmpl_mock",
    object: "chat.completion.chunk",
    created: 1_786_118_400,
    model: "deepseek-v4-flash",
  };
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  response.write(`data: ${JSON.stringify({
    ...base,
    choices: [{ index: 0, delta, finish_reason: null }],
  })}\n\n`);
  response.write(`data: ${JSON.stringify({
    ...base,
    choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
  })}\n\n`);
  response.write(`data: ${JSON.stringify({
    ...base,
    choices: [],
    usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
  })}\n\n`);
  response.end("data: [DONE]\n\n");
}

function messageText(message) {
  if (typeof message?.content === "string") return message.content;
  if (!Array.isArray(message?.content)) return "";
  return message.content
    .map(part => typeof part?.text === "string" ? part.text : "")
    .join("\n");
}

function toolName(tool) {
  return tool?.function?.name ?? tool?.name;
}

function allToolCalls(payload) {
  return (payload.messages ?? [])
    .filter(message => message?.role === "assistant" && Array.isArray(message.tool_calls))
    .flatMap(message => message.tool_calls);
}

function toolArguments(toolCall) {
  try {
    return JSON.parse(toolCall?.function?.arguments ?? "{}");
  } catch {
    return {};
  }
}

function mockToolCall(id, name, args) {
  return {
    role: "assistant",
    content: "",
    reasoning_content: REASONING,
    tool_calls: [{
      id,
      type: "function",
      function: { name, arguments: JSON.stringify(args) },
    }],
  };
}

function agentToolResponse(payload) {
  const available = new Set((payload.tools ?? []).map(toolName));
  const calls = allToolCalls(payload);
  const hasCall = (name, filename) => calls.some(call => {
    if (call?.function?.name !== name) return false;
    return filename === undefined || toolArguments(call).filename === filename;
  });
  const requireTool = name => {
    if (available.has(name)) return true;
    compatibilityFailures += 1;
    console.error(`MOCK_COMPAT_FAIL agent_tool_missing_${name}`);
    return false;
  };

  if (!hasCall("createGadget")) {
    if (!requireTool("createGadget")) return null;
    return mockToolCall("call_mock_create_gadget", "createGadget", {
      title: "Mock Agent Proof",
      bindingName: "AGENT_PROOF",
    });
  }
  if (!hasCall("writeFile", "server.js")) {
    if (!requireTool("writeFile")) return null;
    return mockToolCall("call_mock_write_server", "writeFile", {
      workpiece: "AGENT_PROOF",
      filename: "server.js",
      content: [
        'import { DurableObject } from "cloudflare:workers";',
        "",
        "export class Gadget extends DurableObject {",
        "  calculate() { return 2 + 2; }",
        "}",
        "",
      ].join("\n"),
    });
  }
  if (!hasCall("writeFile", "client.js")) {
    if (!requireTool("writeFile")) return null;
    return mockToolCall("call_mock_write_client", "writeFile", {
      workpiece: "AGENT_PROOF",
      filename: "client.js",
      content: [
        "const value = await gadget.calculate();",
        'document.body.textContent = `2 + 2 = ${value}`;',
        "",
      ].join("\n"),
    });
  }
  if (!hasCall("executeCode")) {
    if (!requireTool("executeCode")) return null;
    return mockToolCall("call_mock_execute_test", "executeCode", {
      code: [
        "export default async function(self, env, ctx) {",
        "  const value = await env.AGENT_PROOF.calculate();",
        '  if (value !== 4) throw new Error(`expected 4, got ${value}`);',
        '  return `PASS artifact returned ${value}`;',
        "}",
        "",
      ].join("\n"),
    });
  }
  return {
    role: "assistant",
    content: "MOCK_AGENT_COMPLETE: Gadget files created and artifact test passed.",
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

    const userText = (payload.messages ?? [])
      .filter(message => message?.role === "user")
      .map(messageText)
      .join("\n");
    const isAgentFlow = userText.includes("CFOS_MOCK_AGENT");
    const isNormalFlow = !isAgentFlow && userText.includes("CFOS_MOCK_NORMAL");
    const hasAvailableTools = Boolean(payload.tools?.length);

    // Cloudflare OS also uses the selected quick model for short metadata
    // requests such as thread and Gadget titles. Those requests contain the
    // original prompt but intentionally expose no tools; keep them separate
    // from the agent transcript so deterministic QA does not try to emit a
    // tool call into a text-only generation.
    if ((isAgentFlow || isNormalFlow) && !hasAvailableTools) {
      sendCompletion(response, payload, {
        role: "assistant",
        content: isAgentFlow ? "Mock Agent QA" : "Mock Normal QA",
      });
      return;
    }
    const hasToolOutput = payload.messages?.some(message => message.role === "tool");
    if (hasToolOutput) {
      const assistantToolCalls = (payload.messages ?? []).filter(message =>
        message.role === "assistant" && message.tool_calls?.length);
      for (const assistantToolCall of assistantToolCalls) {
        if (assistantToolCall.content === null) {
          compatibilityFailures += 1;
          console.error("MOCK_COMPAT_FAIL assistant_tool_call_content_null");
          sendJson(response, 409, {
            error: { message: "assistant tool-call content was null" },
          });
          return;
        }
        if (assistantToolCall.reasoning_content !== REASONING) {
          compatibilityFailures += 1;
          const category = !Object.hasOwn(assistantToolCall, "reasoning_content")
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
      }
      if (isAgentFlow) {
        const next = agentToolResponse(payload);
        if (!next) {
          sendJson(response, 422, { error: { message: "required agent tool unavailable" } });
          return;
        }
        sendCompletion(response, payload, next,
            next.tool_calls?.length ? "tool_calls" : "stop");
        return;
      }
      sendCompletion(response, payload, {
        role: "assistant",
        content: "mock tool round-trip complete",
      });
      return;
    }

    if (isNormalFlow) {
      sendCompletion(response, payload, {
        role: "assistant",
        content: "MOCK_NORMAL_COMPLETE: Cloudflare OS streaming chat succeeded.",
      });
      return;
    }

    if (isAgentFlow) {
      const next = agentToolResponse(payload);
      if (!next) {
        sendJson(response, 422, { error: { message: "required agent tool unavailable" } });
        return;
      }
      sendCompletion(response, payload, next, "tool_calls");
      return;
    }

    if (payload.tools?.length) {
      sendCompletion(response, payload, {
        role: "assistant",
        content: "",
        reasoning_content: REASONING,
        tool_calls: [{
          id: "call_mock_write_file",
          type: "function",
          function: {
            name: "write_file",
            arguments: JSON.stringify({ path: "bridge.txt", content: "mock bridge ok" }),
          },
        }],
      }, "tool_calls");
      return;
    }

    sendCompletion(response, payload, {
      role: "assistant",
      content: "mock normal response complete",
    });
  });
});

server.listen(PORT, "0.0.0.0");

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
