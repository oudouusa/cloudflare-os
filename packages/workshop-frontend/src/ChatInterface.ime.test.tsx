// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import {act, type ButtonHTMLAttributes, type ReactNode} from "react";
import {createRoot, type Root} from "react-dom/client";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

const testState = vi.hoisted(() => ({
  onSend: vi.fn<(message: unknown) => Promise<void>>(async () => {}),
}));

vi.mock("@cloudflare/kumo", () => {
  const Root = ({children}: {children?: ReactNode}) => <>{children}</>;
  const Trigger = ({render}: {render?: ReactNode}) => <>{render}</>;
  const Content = ({children}: {children?: ReactNode}) => <>{children}</>;
  const Item = ({children}: {children?: ReactNode}) => <>{children}</>;
  const Title = ({children}: {children?: ReactNode}) => <>{children}</>;
  const Button = ({variant: _variant, shape: _shape, ...props}:
      ButtonHTMLAttributes<HTMLButtonElement> & {variant?: string; shape?: string}) =>
    <button {...props} />;
  const DropdownMenu = Object.assign(Root, {Trigger, Content, Item});
  const Popover = Object.assign(Root, {Trigger, Content, Title});
  return {
    DropdownMenu,
    Popover,
    Tooltip: Root,
    Button,
    useKumoToastManager: () => ({add: vi.fn<(toast: unknown) => void>()}),
  };
});

vi.mock("./AuthContext", () => ({
  useAuthenticatedApi: () => ({authenticatedApi: null}),
}));

vi.mock("./GatekeeperModal", () => ({default: () => null}));

import {ChatInput} from "./ChatInterface";

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

class TestResizeObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}

describe("ChatInput IME handling", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <ChatInput
          createCapsuleGatekeeper={async () => null}
          getOverseer={() => Promise.reject(new Error("not used"))}
          onSend={testState.onSend}
          isAgentActive={false}
          models={[]}
          selectedModel={null}
          onModelChange={() => {}}
          seedText="日本語"
          seedNonce={1}
        />,
      );
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const textarea = () => {
    const element = container.querySelector<HTMLTextAreaElement>('textarea[role="combobox"]');
    if (!element) throw new Error("composer textarea not found");
    return element;
  };

  const pressEnter = async (keyCode = 13) => {
    const event = new KeyboardEvent("keydown", {bubbles: true, cancelable: true, key: "Enter"});
    Object.defineProperty(event, "keyCode", {value: keyCode});
    await act(async () => textarea().dispatchEvent(event));
  };

  it("does not send the Enter key that confirms an active composition", async () => {
    await act(async () => {
      textarea().dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true}));
    });
    await pressEnter();
    expect(testState.onSend).not.toHaveBeenCalled();

    await act(async () => {
      textarea().dispatchEvent(new CompositionEvent("compositionend", {bubbles: true}));
    });
    await pressEnter();
    expect(testState.onSend).toHaveBeenCalledTimes(1);
    expect(testState.onSend.mock.calls[0].slice(0, 2)).toEqual(["日本語", null]);
  });

  it("does not send Safari's legacy process-key Enter", async () => {
    await pressEnter(229);
    expect(testState.onSend).not.toHaveBeenCalled();
  });
});
