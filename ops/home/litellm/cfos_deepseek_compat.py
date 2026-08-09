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
from functools import wraps
from typing import Any
from uuid import uuid4

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
            pending = [text] if text else []
            continue
        if item_type in ("function_call", "custom_tool_call"):
            call_id = item.get("call_id") or item.get("id")
            if isinstance(call_id, str) and call_id and pending:
                result[call_id] = "\n".join(pending)
            continue
        if item_type in ("function_call_output", "custom_tool_call_output", "tool_result"):
            pending.clear()
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


def _object_field(value: object, name: str) -> object:
    if isinstance(value, dict):
        return value.get(name)
    return getattr(value, name, None)


def _completed_reasoning_text(response: object) -> str:
    """Read reasoning retained on a completed Chat Completions response."""
    choices = _object_field(response, "choices")
    if not isinstance(choices, list) or not choices:
        return ""
    message = _object_field(choices[0], "message")
    if message is None:
        return ""
    for name in ("reasoning_content", "reasoning", "reasoning_text"):
        value = _object_field(message, name)
        if isinstance(value, str) and value:
            return value
    provider_fields = _object_field(message, "provider_specific_fields")
    if isinstance(provider_fields, dict):
        value = provider_fields.get("reasoning_content")
        if isinstance(value, str) and value:
            return value
    return ""


def _queue_completed_reasoning_fallback(iterator: Any) -> None:
    """Backfill missing Responses reasoning events from the completed stream.

    Some OpenCode Go streams retain reasoning in the completed Chat Completions
    message but do not expose an initial ``reasoning_content`` delta. LiteLLM
    therefore includes the reasoning item only in ``response.completed``. The
    Cloudflare OS Responses client intentionally persists reasoning only after a
    matching ``response.output_item.done`` event, so synthesize that event pair
    before the terminal response. This is a no-op when LiteLLM already emitted
    reasoning incrementally.
    """
    if not _is_deepseek_v4_flash(getattr(iterator, "model", None)):
        return
    if getattr(iterator, "_reasoning_done_emitted", False):
        return
    pending = getattr(iterator, "_cfos_completed_reasoning_events", None)
    if isinstance(pending, list) and pending:
        return

    response = getattr(iterator, "litellm_model_response", None)
    if response is None:
        response = iterator.create_litellm_model_response()
        iterator.litellm_model_response = response
    reasoning = _completed_reasoning_text(response)
    if not reasoning:
        return

    from litellm.types.llms.openai import (
        BaseLiteLLMOpenAIResponseObject,
        OutputItemAddedEvent,
        ResponsesAPIStreamEvents,
    )

    item_id = (
        getattr(iterator, "_reasoning_item_id", None)
        or getattr(iterator, "_cached_reasoning_item_id", None)
        or f"rs_{uuid4()}"
    )
    iterator._reasoning_item_id = item_id
    iterator._cached_reasoning_item_id = item_id

    iterator._sequence_number += 1
    added = OutputItemAddedEvent(
        type=ResponsesAPIStreamEvents.OUTPUT_ITEM_ADDED,
        output_index=0,
        item=BaseLiteLLMOpenAIResponseObject(
            **{
                "id": item_id,
                "type": "reasoning",
                "status": "in_progress",
                "summary": None,
            }
        ),
    )
    added.__dict__["sequence_number"] = iterator._sequence_number

    iterator._sequence_number += 1
    done = iterator.create_reasoning_output_item_done_event(
        reasoning_item_id=item_id,
        reasoning_content=reasoning,
        sequence_number=iterator._sequence_number,
    )
    iterator._cfos_completed_reasoning_events = [added, done]
    iterator._reasoning_done_emitted = True
    iterator._reasoning_active = False


def _install_empty_stream_choices_guard() -> None:
    """Ignore DeepSeek stream metadata chunks that contain no choices.

    OpenCode Go can emit a successful Chat Completions stream chunk with
    ``choices=[]``. LiteLLM 1.95.0's Responses bridge indexes ``choices[0]`` in
    three private helpers, causing a late HTTP-200 stream failure after the
    provider has already completed inference. Keep the chunk available to the
    iterator's usage/final-response accumulator, but make the content-specific
    helpers no-ops for this one pinned model route.
    """
    from litellm.responses.litellm_completion_transformation.streaming_iterator import (
        LiteLLMCompletionStreamingIterator,
    )

    iterator = LiteLLMCompletionStreamingIterator
    if getattr(iterator, "_cfos_empty_choices_guard_installed", False):
        return

    original_delta = iterator._get_delta_string_from_streaming_choices
    original_ensure = iterator._ensure_output_item_for_chunk
    original_reasoning_end = iterator._is_reasoning_end
    original_common_done = iterator.common_done_event_logic

    @wraps(original_delta)
    def guarded_delta(self: Any, choices: list[Any]) -> str:
        if _is_deepseek_v4_flash(getattr(self, "model", None)) and not choices:
            return ""
        return original_delta(self, choices)

    @wraps(original_ensure)
    def guarded_ensure(self: Any, chunk: Any) -> None:
        if (
            _is_deepseek_v4_flash(getattr(self, "model", None))
            and not getattr(chunk, "choices", None)
        ):
            return None
        return original_ensure(self, chunk)

    @wraps(original_reasoning_end)
    def guarded_reasoning_end(self: Any, chunk: Any) -> bool:
        if (
            _is_deepseek_v4_flash(getattr(self, "model", None))
            and not getattr(chunk, "choices", None)
        ):
            return False
        return original_reasoning_end(self, chunk)

    @wraps(original_common_done)
    def guarded_common_done(self: Any, sync_mode: bool = True) -> Any:
        _queue_completed_reasoning_fallback(self)
        pending = getattr(self, "_cfos_completed_reasoning_events", None)
        if isinstance(pending, list) and pending:
            return pending.pop(0)
        return original_common_done(self, sync_mode)

    iterator._get_delta_string_from_streaming_choices = guarded_delta
    iterator._ensure_output_item_for_chunk = guarded_ensure
    iterator._is_reasoning_end = guarded_reasoning_end
    iterator.common_done_event_logic = guarded_common_done
    iterator._cfos_empty_choices_guard_installed = True
    iterator._cfos_completed_reasoning_fallback_installed = True


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


_install_empty_stream_choices_guard()
cfos_deepseek_compat = CloudflareOsDeepSeekCompat()
