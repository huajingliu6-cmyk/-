import { describe, expect, it } from "vitest";
import {
  parseResponseJson,
  readJsonIfPresent,
} from "@/projects/assets/parse-response-json";

function makeResponse(body: string, status = 200): Response {
  if (status === 204) {
    return new Response(null, { status: 204 });
  }
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("parseResponseJson", () => {
  it("parses valid JSON", async () => {
    const payload = await parseResponseJson<{ ok: boolean }>(
      makeResponse(JSON.stringify({ ok: true })),
    );
    expect(payload).toEqual({ ok: true });
  });

  it("rejects empty 200 body with friendly Chinese error", async () => {
    await expect(parseResponseJson(makeResponse("   "))).rejects.toThrow(
      /服务器没有返回有效数据/,
    );
  });

  it("treats HTTP 204 empty as success null", async () => {
    await expect(parseResponseJson(makeResponse("", 204))).resolves.toBeNull();
    await expect(readJsonIfPresent(makeResponse("", 204))).resolves.toBeNull();
  });

  it("treats HTTP 202 empty as accepted null", async () => {
    await expect(parseResponseJson(makeResponse("", 202))).resolves.toBeNull();
  });

  it("rejects non-JSON with status in Chinese error", async () => {
    await expect(parseResponseJson(makeResponse("<html>", 502))).rejects.toThrow(
      /服务器返回了无效响应.*502/,
    );
  });

  it("never surfaces Unexpected end of JSON input", async () => {
    try {
      await parseResponseJson(makeResponse(""));
      throw new Error("expected throw");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toMatch(/Unexpected end of JSON input/i);
      expect(message).toMatch(/服务器没有返回有效数据/);
    }
  });
});
