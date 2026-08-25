import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { resolveAvailableAssetExtractionModels } from "@/projects/assets/extraction/available-extraction-models";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

describe("script confirm extract dialog", () => {
  const workspace = readSrc("src/projects/script/ScriptCreationWorkspace.tsx");
  const dialog = readSrc("src/projects/script/ScriptConfirmExtractDialog.tsx");
  const confirmRoute = readSrc(
    "src/app/api/projects/[projectId]/script-draft/confirm-split/route.ts",
  );
  const afterConfirm = readSrc(
    "src/projects/assets/extraction/after-confirm.ts",
  );

  it("opens extract prompt after first successful confirm instead of text-only note", () => {
    expect(workspace).toContain("ScriptConfirmExtractDialog");
    expect(workspace).toContain("setExtractPromptOpen(true)");
    expect(workspace).toContain("extractPromptFingerprint");
    expect(workspace).not.toContain(
      "请在分镜页选择剧集并点击「提取本集资产」",
    );
    expect(dialog).toContain("剧本已确认");
    expect(dialog).toContain("是否开始提取资产");
    expect(dialog).toContain("script-confirm-extract-start");
    expect(dialog).toContain("script-confirm-extract-later");
    expect(dialog).toContain("fetchAvailableAssetExtractionModels");
    expect(dialog).toContain('scope: "all"');
  });

  it("keeps confirm-split route free of extraction start", () => {
    expect(confirmRoute).toContain("afterScriptSplitConfirmed");
    expect(confirmRoute).not.toContain("startAssetExtractionTask");
    expect(afterConfirm).toContain('return { action: "noop" }');
  });

  it("resolves available extraction models from admin capability availability", () => {
    const ready = resolveAvailableAssetExtractionModels([
      {
        capabilityId: "asset.roster.extract",
        available: true,
        label: "资产名单提取",
      },
      {
        capabilityId: "asset.detail.extract",
        available: true,
        label: "资产详情提取",
      },
    ]);
    expect(ready.ready).toBe(true);
    expect(ready.models.length).toBeGreaterThan(0);
    expect(ready.defaultModelId).toBeTruthy();

    const unavailable = resolveAvailableAssetExtractionModels([
      {
        capabilityId: "asset.roster.extract",
        available: false,
        label: "资产名单提取",
      },
      {
        capabilityId: "asset.detail.extract",
        available: true,
        label: "资产详情提取",
      },
    ]);
    expect(unavailable.ready).toBe(false);
    expect(unavailable.reason).toContain("未配置或不可用");
    expect(unavailable.models).toEqual([]);
  });

  it("guards duplicate extract submission in dialog", () => {
    expect(dialog).toContain("extractInFlightRef");
    expect(dialog).toContain(
      "if (extractDisabled || extractInFlightRef.current) return",
    );
    expect(dialog).toContain("reused?: boolean");
  });

  it("opens extract prompt after auto-split and confirmed-script click", () => {
    expect(workspace).toContain("openExtractPromptAfterConfirm");
    expect(workspace).toContain(
      "openExtractPromptAfterConfirm(episodeSplit.sourceFingerprint)",
    );
    expect(workspace).toContain(
      "payload.draft?.episodeSplit?.sourceFingerprint",
    );
    expect(workspace).not.toMatch(
      /episodeSplit\.status === "confirmed"[\s\S]{0,120}goToAssets\(\)/,
    );
  });

  it("skips reopening extract prompt on idempotent confirm", () => {
    expect(workspace).toContain("openExtractPromptAfterConfirm");
    expect(workspace).toContain("payload.idempotent");
  });
});
