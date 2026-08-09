"""Runtime regression check for the pinned LiteLLM empty-choices guard."""

import sys
from types import SimpleNamespace

sys.path.insert(0, "/app")

import cfos_deepseek_compat  # noqa: F401
from litellm.responses.litellm_completion_transformation.streaming_iterator import (
    LiteLLMCompletionStreamingIterator,
)


iterator = object.__new__(LiteLLMCompletionStreamingIterator)
iterator.model = "deepseek-v4-flash"

assert LiteLLMCompletionStreamingIterator._cfos_empty_choices_guard_installed is True
assert iterator._get_delta_string_from_streaming_choices([]) == ""
assert iterator._ensure_output_item_for_chunk(SimpleNamespace(choices=[])) is None
assert iterator._is_reasoning_end(SimpleNamespace(choices=[])) is False

assert LiteLLMCompletionStreamingIterator._cfos_completed_reasoning_fallback_installed is True
iterator.litellm_model_response = SimpleNamespace(
    choices=[SimpleNamespace(message=SimpleNamespace(reasoning_content="completed reasoning"))]
)
iterator._reasoning_done_emitted = False
iterator._reasoning_active = False
iterator._reasoning_item_id = None
iterator._cached_reasoning_item_id = None
iterator._sequence_number = 0
iterator._next_tool_output_index = 1
cfos_deepseek_compat._queue_completed_reasoning_fallback(iterator)
fallback_events = iterator._cfos_completed_reasoning_events
assert [event.type for event in fallback_events] == [
    "response.output_item.added",
    "response.output_item.done",
]
assert [event.output_index for event in fallback_events] == [1, 1]
assert iterator._next_tool_output_index == 2
assert fallback_events[0].item.type == "reasoning"
assert fallback_events[1].item.type == "reasoning"
assert fallback_events[1].item.summary[0]["text"] == "completed reasoning"

iterator._cfos_completed_reasoning_events = []
cfos_deepseek_compat._queue_completed_reasoning_fallback(iterator)
assert iterator._cfos_completed_reasoning_events == []

wrapper_iterator = object.__new__(LiteLLMCompletionStreamingIterator)
wrapper_iterator.model = "deepseek-v4-flash"
wrapper_iterator.litellm_model_response = SimpleNamespace(
    choices=[SimpleNamespace(message=SimpleNamespace(reasoning_content="wrapper reasoning"))]
)
wrapper_iterator._reasoning_done_emitted = False
wrapper_iterator._reasoning_active = False
wrapper_iterator._reasoning_item_id = None
wrapper_iterator._cached_reasoning_item_id = None
wrapper_iterator._sequence_number = 0
wrapper_iterator._next_tool_output_index = 1
first = wrapper_iterator.common_done_event_logic(sync_mode=False)
second = wrapper_iterator.common_done_event_logic(sync_mode=False)
assert first.type == "response.output_item.added"
assert second.type == "response.output_item.done"
assert first.output_index == second.output_index == 1
assert second.item.summary[0]["text"] == "wrapper reasoning"

print(
    "PASS DeepSeek stream guards ignore empty metadata and backfill completed reasoning events"
)
