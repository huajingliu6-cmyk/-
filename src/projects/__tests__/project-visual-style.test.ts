import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  PROJECT_VISUAL_STYLE_REQUIRED_MESSAGE,
  PROJECT_VISUAL_STYLES,
  buildProjectVisualStyleDirective,
  isProjectVisualStyleId,
  parseProjectVisualStyleId,
  requireProjectVisualStyleDirective,
} from "@/projects/project-visual-style";
import {
  isCreateProjectReady,
  parseCreateProjectBody,
  validateCreateProjectForm,
} from "@/projects/validate-create-project";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

describe("project visual style catalog", () => {
  it("exposes canonical english ids with chinese labels only for UI", () => {
    expect(PROJECT_VISUAL_STYLES.map((s) => s.id)).toEqual([
      "live_action_cinematic",
      "three_d_animation",
      "hand_drawn_illustration",
      "two_d_animation",
      "comic",
      "traditional_chinese",
    ]);
    expect(isProjectVisualStyleId("真人电影级")).toBe(false);
    expect(parseProjectVisualStyleId(undefined)).toBeNull();
    expect(parseProjectVisualStyleId("live_action_cinematic")).toBe(
      "live_action_cinematic",
    );
  });

  it("requires style before generation and builds directives", () => {
    expect(
      requireProjectVisualStyleDirective({ visualStyle: null }).ok,
    ).toBe(false);
    expect(
      requireProjectVisualStyleDirective({ visualStyle: null }),
    ).toMatchObject({ error: PROJECT_VISUAL_STYLE_REQUIRED_MESSAGE });

    const live = buildProjectVisualStyleDirective({
      visualStyle: "live_action_cinematic",
    });
    expect(live).toContain("[PROJECT_VISUAL_STYLE]");
    expect(live).toContain("写实摄影");
    expect(live).toContain("禁止动漫脸");

    const threeD = buildProjectVisualStyleDirective({
      visualStyle: "three_d_animation",
    });
    expect(threeD).toContain("三维建模");
    expect(threeD).toContain("禁止真人摄影");
  });

  it("keeps storyboard re-export as compatibility shim only", () => {
    const shim = readSrc(
      "src/projects/storyboard/services/project-visual-style.ts",
    );
    expect(shim).toContain('from "@/projects/project-visual-style"');
    expect(shim).not.toContain("live_action_cinematic");
    expect(shim).not.toContain("promptDirective:");
  });
});

describe("create project visualStyle validation", () => {
  it("blocks submit without visualStyle", () => {
    expect(
      isCreateProjectReady({
        creationSource: "story",
        name: "Demo",
        projectMode: "canvas",
        passwordEnabled: false,
        projectPassword: "",
        visualStyle: null,
      }),
    ).toBe(false);
    expect(
      validateCreateProjectForm({
        creationSource: "story",
        name: "Demo",
        projectMode: "canvas",
        passwordEnabled: false,
        projectPassword: "",
        highlights: "",
        visualStyle: null,
      }).visualStyle,
    ).toBe("请选择项目生成风格");
  });

  it("rejects illegal visualStyle and client stylePrompt overrides", () => {
    const illegal = parseCreateProjectBody({
      name: "Demo",
      creationSource: "story",
      projectMode: "canvas",
      passwordEnabled: false,
      visualStyle: "真人电影级",
    });
    expect(illegal.ok).toBe(false);

    const override = parseCreateProjectBody({
      name: "Demo",
      creationSource: "story",
      projectMode: "canvas",
      passwordEnabled: false,
      visualStyle: "live_action_cinematic",
      stylePrompt: "override",
    });
    expect(override.ok).toBe(false);

    const ok = parseCreateProjectBody({
      name: "Demo",
      creationSource: "story",
      projectMode: "canvas",
      passwordEnabled: false,
      visualStyle: "three_d_animation",
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.visualStyle).toBe("three_d_animation");
  });

  it("wires create wizard and rules dialog to GlassSelect + persistence", () => {
    const wizard = readSrc(
      "src/projects/components/CreateProjectWizardDialog.tsx",
    );
    expect(wizard).toContain("请选择项目生成风格");
    expect(wizard).toContain("GlassSelect");
    expect(wizard).toContain("visualStyle: state.visualStyle");
    expect(wizard).not.toContain("<select");

    const rules = readSrc("src/projects/components/ProjectRulesDialog.tsx");
    expect(rules).toContain("修改后仅影响后续生成，已生成的资产和分镜不会自动重做。");
    expect(rules).toContain("visualStyle");
    expect(rules).toContain("GlassSelect");
  });
});
