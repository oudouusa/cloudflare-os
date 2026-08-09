import type {KeyboardEvent as ReactKeyboardEvent} from "react";
import {describe, expect, it} from "vitest";
import {isComposingKeyEvent} from "./imeComposition";

describe("isComposingKeyEvent", () => {
  it("recognizes an active native composition", () => {
    const event = {isComposing: true, keyCode: 13} as KeyboardEvent;
    expect(isComposingKeyEvent(event)).toBe(true);
  });

  it("unwraps React keyboard events", () => {
    const event = {
      nativeEvent: {isComposing: true, keyCode: 13},
    } as unknown as ReactKeyboardEvent;
    expect(isComposingKeyEvent(event)).toBe(true);
  });

  it("recognizes Safari's legacy process-key signal", () => {
    const event = {isComposing: false, keyCode: 229} as KeyboardEvent;
    expect(isComposingKeyEvent(event)).toBe(true);
  });

  it("does not treat an ordinary Enter key as composition", () => {
    const event = {isComposing: false, keyCode: 13} as KeyboardEvent;
    expect(isComposingKeyEvent(event)).toBe(false);
  });
});
