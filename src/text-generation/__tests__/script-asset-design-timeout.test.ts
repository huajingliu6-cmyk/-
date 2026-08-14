import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import type { AuthUser } from "@/auth/types";
import {
  updateCapabilityBinding,
  updateGenerationApiConfig,
} from "@/auth/api-config";
import { createProjectRecord } from "@/projects/project-access";
import { saveScriptDraft } from "@/projects/script/script-draft-store";
import { listTextJobs } from "@/text-generation/job-store";
import { runTextGenerationStream } from "@/text-generation/run-generation";
import { parseEpisodeAssetDesignOutput } from "@/projects/assets/episode-design/schema";
import * as generationAbort from "@/text-generation/generation-abort";
import { MockTextProvider } from "@/text-generation/provider/mock-provider";
import type { ProviderTextStreamEvent } from "@/text-generation/types";

function auth(id: string): AuthUser {
  return {
    id,
    username: id,
    role: "user",
    displayName: id,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

async function drainSse(gen: AsyncGenerator<string, void, unknown>) {
  const codes: string[] = [];
  for await (const chunk of gen) {
    const match = /event:\s*error\ndata:\s*(\{[\s\S]*?\})\n\n/.exec(chunk);
    if (match?.[1]) {
      try {
        const data = JSON.parse(match[1]) as { code?: string };
        if (data.code) codes.push(data.code);
      } catch {
        /* ignore */
      }
    }
  }
  return codes;
}

describe("script_asset_design timeout diagnostics", () => {
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const previousProvider = process.env.TEXT_LLM_PROVIDER;
  let tmp = "";
  let streamSpy: { mockRestore: () => void } | null = null;
  let timeoutSpy: { mockRestore: () => void } | null = null;

  beforeEach(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-timeout-diag-"));
    process.env.APP_DATA_DIR = tmp;
    process.env.TEXT_LLM_PROVIDER = "mock";
    await updateGenerationApiConfig("episode-asset-design-text", {
      provider: "mock",
      model: "mock-assets",
      enabled: true,
    });
    await updateCapabilityBinding(
      "asset.episode-design.generate",
      { profileSlotId: "episode-asset-design-text", enabled: true },
      "admin1",
    );

    timeoutSpy = vi
      .spyOn(generationAbort, "resolveTimeoutMsForOutputKind")
      .mockImplementation((outputKind: string | null | undefined) =>
        outputKind === "script_asset_design" ? 80 : 170_000,
      );

    streamSpy = vi
      .spyOn(MockTextProvider.prototype, "streamText")
      .mockImplementation(async function* (input: {
        signal?: AbortSignal;
      }): AsyncGenerator<ProviderTextStreamEvent, void, unknown> {
        yield { type: "delta", text: '{"version":1,"assets":[' };
        await new Promise<void>((resolve) => {
          const finish = () => resolve();
          if (input.signal?.aborted) {
            finish();
            return;
          }
          input.signal?.addEventListener("abort", finish, { once: true });
          setTimeout(finish, 500);
        });
        if (input.signal?.aborted) {
          yield { type: "error", code: "CANCELLED", message: "已取消" };
          return;
        }
        yield { type: "done" };
      });
  });

  afterEach(() => {
    streamSpy?.mockRestore();
    timeoutSpy?.mockRestore();
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    if (previousProvider === undefined) delete process.env.TEXT_LLM_PROVIDER;
    else process.env.TEXT_LLM_PROVIDER = previousProvider;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("saves partial length and redacted preview on MODEL_TIMEOUT", async () => {
    const owner = auth("timeout-owner");
    const project = await createProjectRecord(owner.id, {
      name: "Timeout",
      creationSource: "script-upload",
      projectMode: "full-stack",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
    });
    await saveScriptDraft({
      projectId: project.projectId,
      sourceText: "第1集\n甲出场。",
      episodes: [],
    });

    const codes = await drainSse(
      runTextGenerationStream({
        projectId: project.projectId,
        user: owner,
        outputKind: "script_asset_design",
        brief: "",
        modelKey: "balanced-default",
        targetChars: 2000,
        idempotencyKey: "idem-timeout-partial-1",
      }),
    );
    expect(codes).toContain("MODEL_TIMEOUT");

    const jobs = await listTextJobs(project.projectId);
    const job = jobs.find((j) => j.outputKind === "script_asset_design");
    expect(job?.errorCode).toBe("MODEL_TIMEOUT");
    expect(job?.actualChars ?? 0).toBeGreaterThan(0);
    expect(job?.content).toContain('"version":1');
    expect(job?.outputPreview).toBeTruthy();
    expect(job?.outputPreview).not.toMatch(/sk-[a-zA-Z0-9]{8,}/);

    const parsed = parseEpisodeAssetDesignOutput(job?.content ?? "");
    expect(parsed.ok).toBe(false);
  });
});

describe("incomplete asset JSON never applies", () => {
  it("rejects truncated JSON payloads", () => {
    const parsed = parseEpisodeAssetDesignOutput('{"version":1,"assets":[');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect([
        "EPISODE_ASSET_DESIGN_OUTPUT_INVALID",
        "EPISODE_ASSET_DESIGN_CONTENT_EMPTY",
      ]).toContain(parsed.code);
    }
  });
});
