import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth/require-access", () => ({
  requireVideoCanvasAccess: vi.fn(),
}));
vi.mock("@/workflow/lib/remote-legacy-video-shot", () => ({
  submitLegacyVideoShotToGo: vi.fn(),
}));

import { requireVideoCanvasAccess } from "@/auth/require-access";
import { submitLegacyVideoShotToGo } from "@/workflow/lib/remote-legacy-video-shot";
import { POST } from "@/app/api/generate/video-shot/route";

const validBody = {
  projectId: "project-1",
  videoShotNodeId: "shot-1",
  prompt: "????",
};

describe("legacy video-shot BFF", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireVideoCanvasAccess).mockResolvedValue({
      ok: true,
      user: { id: "owner-1" },
      access: {},
    } as Awaited<ReturnType<typeof requireVideoCanvasAccess>>);
  });

  it("validates access and forwards the request to Go", async () => {
    vi.mocked(submitLegacyVideoShotToGo).mockResolvedValue(
      Response.json({ error: "deprecated" }, { status: 500 }),
    );
    const response = await POST(new Request("http://localhost", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody),
    }));
    expect(requireVideoCanvasAccess).toHaveBeenCalledWith("project-1");
    expect(submitLegacyVideoShotToGo).toHaveBeenCalledWith(
      expect.objectContaining(validBody),
      "owner-1",
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "deprecated" });
  });

  it("does not call Go when validation fails", async () => {
    const response = await POST(new Request("http://localhost", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...validBody, prompt: "" }),
    }));
    expect(response.status).toBe(400);
    expect(submitLegacyVideoShotToGo).not.toHaveBeenCalled();
  });
});
