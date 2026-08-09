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

print("PASS DeepSeek empty-choices stream metadata is ignored by content helpers")
