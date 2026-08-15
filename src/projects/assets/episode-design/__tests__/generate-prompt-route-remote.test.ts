import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DESIGN_PROMPT_MODEL_ID,
  DESIGN_PROMPT_MODELS,
  getDesignPromptModel,
  isDesignPromptModelId,
} from "@/projects/assets/episode-design/design-prompt-models";

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
const generatePrompt = readFileSync(
  path.join(
    process.cwd(),
    "src/projects/assets/episode-design/generate-design-prompt.ts",
  ),
  "utf-8",
);
const modal = readFileSync(
  path.join(process.cwd(), "src/projects/assets/DesignAssetModal.tsx"),
  "utf-8",
);

describe("design prompt generation remote routes", () => {
  it("uses remote service guards instead of local dependency blockers", () => {
    expect(managementRoute).toContain("guardEpisodeAssetDesignRemoteData");
    expect(managementRoute).not.toContain(
      "rejectRemoteEpisodeAssetDesignLocalDependency",
    );
    expect(workspaceRoute).toContain("guardWorkspaceRemoteData");
    expect(workspaceRoute).not.toContain("rejectRemoteWorkspaceLocalDependency");
  });

  it("persists both the generation job and the updated design document", () => {
    for (const route of [managementRoute, workspaceRoute]) {
      expect(route).toContain("runGenerateDesignPromptPost");
    }
    expect(managementRoute).toContain("patchEpisodeItemDesignPrompt");
    expect(workspaceRoute).toContain("patchWorkspaceItemDesignPrompt");
    const helper = readFileSync(
      path.join(
        process.cwd(),
        "src/projects/assets/episode-design/run-generate-design-prompt-route.ts",
      ),
      "utf-8",
    );
    expect(helper).toContain("await saveTextJob(historyJob)");
    expect(helper).toContain("designConversation: nextConversation");
  });

  it("validates promptModelId on management and workspace routes", () => {
    const helper = readFileSync(
      path.join(
        process.cwd(),
        "src/projects/assets/episode-design/run-generate-design-prompt-route.ts",
      ),
      "utf-8",
    );
    expect(helper).toContain("isDesignPromptModelId");
    expect(helper).toContain("INVALID_PROMPT_MODEL");
    expect(helper).toContain('outputKind: "asset_design_prompt"');
    expect(helper).toContain('capabilityId: "asset.design-prompt.generate"');
    expect(helper).not.toContain('modelKey: "episode-asset-design-text"');
    expect(helper).not.toContain('displayModelName: "本集资产设计对话"');
  });

  it("allows formal prompt generation when designConversation is missing", () => {
    const helper = readFileSync(
      path.join(
        process.cwd(),
        "src/projects/assets/episode-design/run-generate-design-prompt-route.ts",
      ),
      "utf-8",
    );
    expect(helper).toContain("designConversation ?? []");
    expect(helper).not.toContain("EXTRACT_CONVERSATION_MISSING");
    expect(helper).not.toContain("本集尚无提取对话");
    expect(helper).toContain("isEpisodeAssetExtractReady");
    expect(generatePrompt).toContain("input.conversation ?? []");
    expect(generatePrompt).not.toContain("本集尚无提取对话，请先点击");
    expect(generatePrompt).not.toContain("EXTRACT_CONVERSATION_MISSING");
  });
});

describe("design prompt model selection", () => {
  it("whitelists Deepseek V4 Pro as the default model", () => {
    expect(DEFAULT_DESIGN_PROMPT_MODEL_ID).toBe("deepseek-v4-pro");
    expect(DESIGN_PROMPT_MODELS[0]?.label).toBe("Deepseek V4 Pro");
    expect(isDesignPromptModelId("deepseek-v4-pro")).toBe(true);
    expect(isDesignPromptModelId("gpt-4o")).toBe(false);
    expect(getDesignPromptModel("deepseek-v4-pro").providerModelId).toBe(
      "deepseek-v4-pro",
    );
  });

  it("passes selected provider model id into HttpCompatibleTextProvider", () => {
    expect(generatePrompt).toContain("getDesignPromptModel");
    expect(generatePrompt).toContain("selectedModel.providerModelId");
    expect(generatePrompt).toContain("selectedProviderModelId");
    expect(generatePrompt).toContain(
      "providerModelId: selectedModel.providerModelId",
    );
    expect(generatePrompt).toMatch(
      /createProviderFromResolved\(\s*resolved,\s*selectedModel\.providerModelId,\s*selectedModel\.providerModelId,\s*\)/,
    );
  });

  it("places one-click copy under the prompt textarea and removes regenerate UI", () => {
    const textareaIdx = modal.indexOf('data-testid="design-prompt-textarea"');
    const copyRowIdx = modal.indexOf('data-testid="design-prompt-copy-row"');
    const footIdx = modal.indexOf('className="ead-modal__foot"');

    expect(textareaIdx).toBeGreaterThan(-1);
    expect(copyRowIdx).toBeGreaterThan(textareaIdx);
    expect(footIdx).toBeGreaterThan(copyRowIdx);

    expect(modal).toContain("GlassSelect");
    expect(modal).toContain("DEFAULT_DESIGN_PROMPT_MODEL_ID");
    expect(modal).toContain("menuPortal");
    expect(modal).not.toContain('data-testid="design-prompt-actions"');
    expect(modal).not.toContain('data-testid="design-regenerate-prompt"');
    expect(modal).not.toContain('data-testid="design-prompt-model"');
    expect(modal).not.toContain("DESIGN_PROMPT_MODEL_OPTIONS");
    expect(modal).not.toContain("重新生成提示词");
    expect(modal).toContain("promptModelId: DEFAULT_DESIGN_PROMPT_MODEL_ID");
    expect(DESIGN_PROMPT_MODELS[0]?.label).toBe("Deepseek V4 Pro");

    const footEnd = modal.indexOf("</footer>", footIdx);
    const footSlice = modal.slice(footIdx, footEnd);
    expect(footSlice).toContain("design-image-edit-toggle");
    expect(footSlice).toContain("二次编辑");
    expect(footSlice).toContain("design-generate-asset");
    expect(footSlice).not.toContain("design-copy");
    expect(footSlice).not.toContain("design-regenerate-prompt");
    expect(modal).not.toContain('data-testid="design-extract-info"');
    expect(modal).not.toContain("资产提取信息");
  });
});
