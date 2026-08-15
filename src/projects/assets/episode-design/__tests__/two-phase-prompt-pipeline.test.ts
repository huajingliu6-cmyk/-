import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  countDesignPromptBatchProgress,
  reconcileStuckDesignPromptItems,
  resolveDesignPromptBatchConcurrency,
} from "@/projects/assets/episode-design/design-prompt-diagnostics";
import {
  autoGenerateMissingFormalDesignPrompts,
  itemNeedsFormalDesignPrompt,
} from "@/projects/assets/episode-design/auto-generate-design-prompts";
import type { EpisodeAssetDesignItem } from "@/projects/assets/episode-design/types";

function makeItem(
  id: string,
  prompt?: { status?: string; text?: string },
): EpisodeAssetDesignItem {
  return {
    id,
    assetType: "character",
    name: `角色${id}`,
    resolution: "create_new",
    source: "ai",
    draft: {
      description: "女主",
      appearance: "短发",
      clothing: "青衫",
      role: "主角",
      age: "28",
      voiceId: null,
      voiceName: null,
      voiceBound: false,
      usageInEpisode: "开场",
      evidence: "第一场",
    },
    designPrompt: prompt
      ? {
          status: (prompt.status as "idle") ?? "idle",
          text: prompt.text ?? "",
          generationId: null,
          sourceFingerprint: null,
          generatedAt: null,
          updatedAt: null,
          errorMessage: null,
          history: [],
        }
      : undefined,
  };
}

describe("two-phase asset extract vs formal prompt contracts", () => {
  const runGeneration = readFileSync(
    path.join(process.cwd(), "src/text-generation/run-generation.ts"),
    "utf-8",
  );
  const generatePrompt = readFileSync(
    path.join(
      process.cwd(),
      "src/projects/assets/episode-design/generate-design-prompt.ts",
    ),
    "utf-8",
  );
  const routeHelper = readFileSync(
    path.join(
      process.cwd(),
      "src/projects/assets/episode-design/run-generate-design-prompt-route.ts",
    ),
    "utf-8",
  );
  const managementRoute = readFileSync(
    path.join(
      process.cwd(),
      "src/app/api/projects/[projectId]/asset-designs/episodes/[episodeId]/items/[itemId]/generate-prompt/route.ts",
    ),
    "utf-8",
  );
  const workspaceRoute = readFileSync(
    path.join(
      process.cwd(),
      "src/app/api/workspace/projects/[projectId]/asset-designs/episodes/[episodeId]/items/[itemId]/generate-prompt/route.ts",
    ),
    "utf-8",
  );
  const autoGen = readFileSync(
    path.join(
      process.cwd(),
      "src/projects/assets/episode-design/auto-generate-design-prompts.ts",
    ),
    "utf-8",
  );
  const workspaceUi = readFileSync(
    path.join(
      process.cwd(),
      "src/projects/assets/EpisodeAssetDesignWorkspace.tsx",
    ),
    "utf-8",
  );

  it("phase 1 extract uses asset.episode-design.generate + episode/script asset outputKind", () => {
    expect(runGeneration).toContain('outputKind === "episode_asset_design"');
    expect(runGeneration).toContain("logAssetExtractRequest");
    expect(runGeneration).toContain("emitAssetExtractDiag");
    expect(runGeneration).toContain("asset.episode-design.generate");
    expect(runGeneration).toContain('messageRoles: "system,user"');
  });

  it("phase 2 formal prompt uses asset.design-prompt.generate only", () => {
    expect(generatePrompt).toContain('capabilityId = "asset.design-prompt.generate"');
    expect(generatePrompt).toContain('outputKind: "asset_design_prompt"');
    expect(generatePrompt).not.toContain(
      'capabilityId = "asset.episode-design.generate"',
    );
    expect(routeHelper).toContain('outputKind: "asset_design_prompt"');
    expect(routeHelper).toContain("logAssetPromptRequest");
    expect(routeHelper).toContain('messageRoles: executionMeta.messageRoles ?? "system,user"');
    for (const route of [managementRoute, workspaceRoute]) {
      expect(route).toContain("runGenerateDesignPromptPost");
      expect(route).not.toContain("EXTRACT_CONVERSATION_MISSING");
      expect(route).not.toContain("episode_asset_design");
    }
  });

  it("phase 2 user payload uses structured facts + episode text", () => {
    expect(generatePrompt).toContain("buildDesignPromptUserPayloadText");
    expect(generatePrompt).toContain("episodeText: input.episodeText");
    expect(generatePrompt).toContain('assembleUntrustedUserData(');
    expect(generatePrompt).toContain('"asset_design_context"');
    expect(generatePrompt).toContain('{ role: "system", content: systemPrompt }');
    expect(generatePrompt).toContain('{ role: "user", content: userPrompt }');
  });

  it("phase 2 batch auto-gen uses generate-prompts route without assistant history", () => {
    expect(autoGen).toContain("buildBatchGeneratePromptsUrl");
    expect(autoGen).toContain("requestFormalDesignPromptBatchGenerate");
    expect(autoGen).toContain("resolveDesignPromptBatchSize");
    expect(autoGen).toContain("Never falls back to extract seed");
  });

  it("resumes missing formal prompts after refresh without repeating extract", () => {
    expect(workspaceUi).toContain("record.items.some(itemNeedsFormalDesignPrompt)");
    expect(workspaceUi).toContain(
      "void kickOffFormalDesignPrompts(record, record.episodeId)",
    );
  });

  it("does not treat extract JSON / field titles as formal prompts", () => {
    expect(routeHelper).toContain('status: "failed"');
    expect(routeHelper).toContain("模型未返回有效的素材提示词");
    expect(autoGen).toContain("Never falls back to extract seed");
    expect(autoGen).toContain("logAssetPromptBatch");
  });
});

describe("design prompt batch concurrency and isolation", () => {
  it("defaults concurrency to 4 and caps at 6", () => {
    expect(resolveDesignPromptBatchConcurrency({})).toBe(4);
    expect(
      resolveDesignPromptBatchConcurrency({
        DESIGN_PROMPT_BATCH_CONCURRENCY: "2",
      }),
    ).toBe(2);
    expect(
      resolveDesignPromptBatchConcurrency({
        DESIGN_PROMPT_BATCH_CONCURRENCY: "99",
      }),
    ).toBe(6);
    expect(resolveDesignPromptBatchConcurrency({}, 3)).toBe(3);
    expect(resolveDesignPromptBatchConcurrency({}, 9)).toBe(6);
  });

  it("creates one independent batch request per chunk and continues after failures", async () => {
    const items = Array.from({ length: 100 }, (_, i) => makeItem(`i${i}`));
    expect(items.filter(itemNeedsFormalDesignPrompt)).toHaveLength(100);

    let inFlight = 0;
    let maxInFlight = 0;
    let calls = 0;
    const failures = new Set(["i3", "i17", "i50"]);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        calls += 1;
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          itemIds?: string[];
        };
        const ids = body.itemIds ?? [];
        const completed = ids.filter((id) => !failures.has(id));
        const failed = ids.filter((id) => failures.has(id));
        return {
          ok: true,
          json: async () => ({
            ok: failed.length === 0,
            generationId: `tg_batch_${calls}`,
            requestedAssetIds: ids,
            completedAssetIds: completed,
            failedAssetIds: failed,
            nextAssetId: failed[0] ?? "",
            batchSize: ids.length,
            items: [
              ...completed.map((id) => ({
                itemId: id,
                status: "ready",
                text: `横构图电影剧照，虚构角色 ${id}，写实影视摄影质感，精细服装材质与真实皮肤细节，浅景深构图，电影级灯光，16:9画幅，可直接用于素材生成。`,
                generationId: `tg_${id}`,
                history: [],
              })),
              ...failed.map((id) => ({
                itemId: id,
                status: "failed",
                text: "",
                generationId: `tg_${id}`,
                history: [],
                errorCode: "PROMPT_GENERATE_FAILED",
                errorMessage: "boom",
              })),
            ],
          }),
        };
      }),
    );

    const result = await autoGenerateMissingFormalDesignPrompts({
      surface: "project_management",
      projectId: "p1",
      episodeId: "e1",
      items,
      batchSize: 5,
      requestConcurrency: 2,
    });

    expect(calls).toBe(21);
    expect(result.started).toBe(100);
    expect(result.ok).toBe(97);
    expect(result.failed).toBe(3);
    expect(result.batchSize).toBe(5);
    expect(result.requestConcurrency).toBe(2);
    expect(maxInFlight).toBeLessThanOrEqual(2);

    vi.unstubAllGlobals();
  });

  it("marks stuck generating prompts as failed after timeout grace", () => {
    const old = new Date(Date.now() - 200_000).toISOString();
    const record = {
      episodeId: "e1",
      episodeNumber: 1,
      status: "review" as const,
      revision: 1,
      contentFingerprint: "fp",
      generationId: null,
      items: [
        makeItem("a", { status: "generating", text: "" }),
        makeItem("b", { status: "ready", text: "正式提示词" }),
      ],
      confirmedAt: null,
      confirmedBy: null,
      confirmedRevision: null,
      updatedAt: old,
    };
    record.items[0]!.designPrompt!.updatedAt = old;

    const reconciled = reconcileStuckDesignPromptItems(record);
    expect(reconciled.changed).toBe(true);
    expect(reconciled.record.items[0]?.designPrompt?.status).toBe("failed");
    expect(reconciled.record.items[1]?.designPrompt?.status).toBe("ready");

    const progress = countDesignPromptBatchProgress(reconciled.record.items);
    expect(progress.ready).toBe(1);
    expect(progress.failed).toBe(1);
    expect(progress.generating).toBe(0);
  });
});
