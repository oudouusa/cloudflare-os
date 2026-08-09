"""Cloudflare OS Responses bridge compatibility for DeepSeek V4 Flash.

LiteLLM translates the Responses API to Chat Completions for this route. DeepSeek
V4 thinking mode requires the preceding reasoning content to be replayed on an
assistant tool-call message, but the generic bridge currently drops Responses
``reasoning`` input items. Keep that data in an async-local ContextVar between
LiteLLM's Responses and Completion deployment hooks, then restore it immediately
before provider dispatch. Nothing is logged or added to request metadata.
"""

import os
from contextvars import ContextVar
from typing import Any

from litellm.integrations.custom_logger import CustomLogger


_reasoning_by_call_id: ContextVar[dict[str, str] | None] = ContextVar(
    "cfos_deepseek_reasoning_by_call_id",
    default=None,
)


def _trace(hook: str, call_type: object, data: dict[str, Any]) -> None:
    """Emit structure-only diagnostics when the isolated mock enables them."""
    if os.environ.get("CFOS_DEEPSEEK_COMPAT_TRACE") != "1":
        return
    print(
        "CFOS_COMPAT_TRACE"
        f" hook={hook} call_type={call_type}"
        f" model_match={_is_deepseek_v4_flash(data.get('model'))}"
        f" has_input={isinstance(data.get('input'), list)}"
        f" has_messages={isinstance(data.get('messages'), list)}",
        flush=True,
    )


def _is_deepseek_v4_flash(model: object) -> bool:
    return isinstance(model, str) and model.rsplit("/", 1)[-1] == "deepseek-v4-flash"


def _reasoning_text(item: dict[str, Any]) -> str:
    parts: list[str] = []
    direct = item.get("reasoning_content")
    if isinstance(direct, str) and direct:
        parts.append(direct)
    for field in ("summary", "content"):
        blocks = item.get(field)
        if not isinstance(blocks, list):
            continue
        for block in blocks:
            if not isinstance(block, dict):
                continue
            text = block.get("text")
            if isinstance(text, str) and text:
                parts.append(text)
    return "\n".join(parts)


def _collect_reasoning(input_items: object) -> dict[str, str]:
    if not isinstance(input_items, list):
        return {}
    pending: list[str] = []
    result: dict[str, str] = {}
    for item in input_items:
        if not isinstance(item, dict):
            continue
        item_type = item.get("type")
        if item_type == "reasoning":
            text = _reasoning_text(item)
            if text:
                pending.append(text)
            continue
        if item_type in ("function_call", "custom_tool_call"):
            call_id = item.get("call_id") or item.get("id")
            if isinstance(call_id, str) and call_id and pending:
                result[call_id] = "\n".join(pending)
            continue
        if item_type == "message" and item.get("role") in ("user", "developer", "system"):
            pending.clear()
    return result


def _restore_reasoning(data: dict[str, Any], reasoning: dict[str, str]) -> None:
    messages = data.get("messages")
    if not isinstance(messages, list):
        return
    for message in messages:
        if not isinstance(message, dict) or message.get("role") != "assistant":
            continue
        tool_calls = message.get("tool_calls")
        if not isinstance(tool_calls, list) or not tool_calls:
            continue
        restored: str | None = None
        for tool_call in tool_calls:
            if not isinstance(tool_call, dict):
                continue
            call_id = tool_call.get("id")
            if isinstance(call_id, str) and call_id in reasoning:
                restored = reasoning[call_id]
                break
        if restored:
            message["reasoning_content"] = restored
        if message.get("content") is None:
            message["content"] = ""


class CloudflareOsDeepSeekCompat(CustomLogger):
    """Preserve DeepSeek V4 thinking context across LiteLLM's API bridge."""

    async def async_pre_call_deployment_hook(
        self,
        kwargs: dict[str, Any],
        call_type: object,
    ) -> dict[str, Any]:
        _trace("deployment", call_type, kwargs)
        if not _is_deepseek_v4_flash(kwargs.get("model")):
            return kwargs
        call_type_name = getattr(call_type, "value", call_type)
        if call_type_name in ("responses", "aresponses"):
            # This hook and the internal completion bridge run in the same
            # async task, unlike the proxy-level hook and router task.
            _reasoning_by_call_id.set(_collect_reasoning(kwargs.get("input")))
            return kwargs
        if call_type_name in ("completion", "acompletion"):
            reasoning = _reasoning_by_call_id.get() or {}
            _reasoning_by_call_id.set(None)
            _restore_reasoning(kwargs, reasoning)
        return kwargs


cfos_deepseek_compat = CloudflareOsDeepSeekCompat()
