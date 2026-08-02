import { describe, expect, it } from "vitest";
import {
  appendConversationMessage,
  buildRedesignUserMessage,
  isEpisodeAssetExtractReady,
  parseDesignConversation,
} from "@/projects/assets/episode-design/design-conversation";

describe("episode design conversation helpers", () => {
  it("gates design until extract is ready", () => {
    expect(isEpisodeAssetExtractReady("not_started")).toBe(false);
    expect(isEpisodeAssetExtractReady("generating")).toBe(false);
    expect(isEpisodeAssetExtractReady("failed")).toBe(false);
    expect(isEpisodeAssetExtractReady("review")).toBe(true);
    expect(isEpisodeAssetExtractReady("confirmed")).toBe(true);
    expect(isEpisodeAssetExtractReady("stale")).toBe(true);
  });

  it("builds redesign cue as {name}重新设计", () => {
    expect(buildRedesignUserMessage("江宸")).toBe("江宸重新设计");
    expect(buildRedesignUserMessage(" 旧伞 ")).toBe("旧伞重新设计");
  });

  it("appends messages and keeps extract head when trimming", () => {
    const seed = [
      { role: "system" as const, content: "sys" },
      { role: "user" as const, content: "extract-user" },
      { role: "assistant" as const, content: "extract-json" },
    ];
    let conversation = seed;
    for (let i = 0; i < 50; i += 1) {
      conversation = appendConversationMessage(conversation, {
        role: "user",
        content: `u${i}`,
      });
      conversation = appendConversationMessage(conversation, {
        role: "assistant",
        content: `a${i}`,
      });
    }
    expect(conversation[0]).toEqual(seed[0]);
    expect(conversation[1]).toEqual(seed[1]);
    expect(conversation[2]).toEqual(seed[2]);
    expect(conversation.length).toBeLessThanOrEqual(40);
  });

  it("parses persisted conversation messages", () => {
    const parsed = parseDesignConversation([
      { role: "system", content: "s", at: "t" },
      { role: "user", content: "u" },
      { role: "assistant", content: "a" },
      { role: "tool", content: "ignore" },
      { role: "user", content: "  " },
    ]);
    expect(parsed).toEqual([
      { role: "system", content: "s", at: "t" },
      { role: "user", content: "u" },
      { role: "assistant", content: "a" },
    ]);
  });
});
