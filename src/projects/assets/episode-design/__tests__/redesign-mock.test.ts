import { describe, expect, it } from "vitest";
import {
  clearLastMockTextRequest,
  getLastMockTextRequest,
  MockTextProvider,
} from "@/text-generation/provider/mock-provider";

describe("mock redesign continuation", () => {
  it("returns image prompt for {name}重新设计 in multi-turn messages", async () => {
    clearLastMockTextRequest();
    const provider = new MockTextProvider();
    let text = "";
    for await (const ev of provider.streamText({
      systemPrompt: "sys",
      userPrompt: "江宸重新设计",
      providerModelId: "mock",
      maxOutputTokens: 1000,
      messages: [
        { role: "system", content: "你是专业影视资产策划师。" },
        { role: "user", content: "【本集正文】江宸出场" },
        {
          role: "assistant",
          content: '{"version":1,"assets":[{"type":"character","name":"江宸"}]}',
        },
        { role: "user", content: "江宸重新设计" },
      ],
    })) {
      if (ev.type === "delta") text += ev.text;
    }
    expect(text).toContain("江宸");
    expect(text).not.toContain('"assets"');
    expect(getLastMockTextRequest()?.userPrompt).toBe("江宸重新设计");
  });
});
