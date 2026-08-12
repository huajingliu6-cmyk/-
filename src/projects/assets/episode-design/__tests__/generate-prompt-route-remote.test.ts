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
      expect(route).toContain("await saveTextJob(historyJob)");
      expect(route).toContain("designConversation: nextConversation");
    }
    expect(managementRoute).toContain("saveEpisodeAssetDesignItems");
    expect(workspaceRoute).toContain("saveWorkspaceEpisodeAssetDesignItems");
  });

  it("validates promptModelId on management and workspace routes", () => {
    for (const route of [managementRoute, workspaceRoute]) {
      expect(route).toContain("isDesignPromptModelId");
      expect(route).toContain("INVALID_PROMPT_MODEL");
      expect(route).toContain("promptModelId,");
      expect(route).toContain("modelKey: resultPromptModelId");
      expect(route).toContain("displayModelName: resultDisplayModelName");
      expect(route).toContain("providerModelId: resultProviderModelId");
      expect(route).not.toContain('modelKey: "episode-asset-design-text"');
      expect(route).not.toContain('displayModelName: "本集资产设计对话"');
    }
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

  it("places regenerate + GlassSelect model under the prompt textarea", () => {
    const textareaIdx = modal.indexOf('data-testid="design-prompt-textarea"');
    const actionsIdx = modal.indexOf('data-testid="design-prompt-actions"');
    const regenerateIdx = modal.indexOf('data-testid="design-regenerate-prompt"');
    const modelIdx = modal.indexOf('data-testid="design-prompt-model"');
    const footIdx = modal.indexOf('className="ead-modal__foot"');

    expect(textareaIdx).toBeGreaterThan(-1);
    expect(actionsIdx).toBeGreaterThan(textareaIdx);
    expect(regenerateIdx).toBeGreaterThan(actionsIdx);
    expect(modelIdx).toBeGreaterThan(regenerateIdx);
    expect(footIdx).toBeGreaterThan(modelIdx);

    expect(modal).toContain("GlassSelect");
    expect(modal).toContain("promptModelId");
    expect(modal).toContain("promptModelId,");
    expect(modal).toContain("DESIGN_PROMPT_MODEL_OPTIONS");
    expect(modal).toContain("menuPortal");
    expect(modal).toContain("DEFAULT_DESIGN_PROMPT_MODEL_ID");
    expect(modal).toContain("DESIGN_PROMPT_MODELS");
    expect(DESIGN_PROMPT_MODELS[0]?.label).toBe("Deepseek V4 Pro");

    const regenerateMatches = modal.match(
      /data-testid="design-regenerate-prompt"/g,
    );
    expect(regenerateMatches).toHaveLength(1);

    const footEnd = modal.indexOf("</footer>", footIdx);
    const footSlice = modal.slice(footIdx, footEnd);
    expect(footSlice).toContain("design-copy");
    expect(footSlice).toContain("design-generate-asset");
    expect(footSlice).not.toContain("design-regenerate-prompt");
    expect(footSlice).not.toContain("重新生成提示词");
  });
});
