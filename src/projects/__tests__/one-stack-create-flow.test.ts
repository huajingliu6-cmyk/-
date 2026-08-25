import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { parseCreateProjectBody } from "@/projects/validate-create-project";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

describe("one-stack create flow contract", () => {
  it("does not expose optional canvas mode in one-stack create wizard", () => {
    const wizard = readSrc("src/projects/components/CreateProjectWizardDialog.tsx");
    const page = readSrc("src/projects/ui/ProjectFlowListPage.tsx");
    expect(wizard).not.toContain("showOptionalCanvas");
    expect(wizard).not.toContain("enableCanvas");
    expect(wizard).not.toContain("cpw-optional-canvas");
    expect(page).not.toContain("showOptionalCanvas");
    expect(page).toContain('listFlowKind={flow.kind}');
  });

  it("keeps one-stack stage nav to script, assets and storyboard only", () => {
    const links = readSrc("src/projects/workbench/ProjectStageNavLinks.tsx");
    expect(links).toContain('"剧本创作"');
    expect(links).toContain('"项目资产"');
    expect(links).toContain('"分镜创作"');
    expect(links).not.toContain("画布");
    expect(links).not.toContain("视频制作");
  });

  it("loads script upload dropzone styles for the wizard", () => {
    const wizard = readSrc("src/projects/components/CreateProjectWizardDialog.tsx");
    const upload = readSrc("src/projects/script/ScriptUploadPanel.tsx");
    expect(upload).toContain('import "@/projects/script/script-workspace.css"');
    expect(wizard).toContain("cpw-form-shell--immediate");
    expect(wizard).toContain("cpw-card--immediate");
  });

  it("routes one-stack script-upload creation to script workspace, not canvas", () => {
    const wizard = readSrc("src/projects/components/CreateProjectWizardDialog.tsx");
    expect(wizard).toContain("/script");
    expect(wizard).not.toContain("/workflow");
    expect(wizard).not.toContain("进入画布");
    expect(wizard).not.toContain("视频制作画布");
  });

  it("shows wizard script file row with delete control after upload", () => {
    const upload = readSrc("src/projects/script/ScriptUploadPanel.tsx");
    expect(upload).toContain("script-upload-file-row");
    expect(upload).toContain('aria-label="删除剧本"');
    expect(upload).toContain('from "lucide-react"');
    expect(upload).toContain("showWizardFileRow");
    expect(upload).toContain("inputRef.current.value = \"\"");
  });

  it("rejects one-stack list flow when client sends canvas mode", () => {
    const parsed = parseCreateProjectBody({
      name: "测试项目",
      creationSource: "script-upload",
      projectMode: "canvas",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
      listFlowKind: "full-stack",
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.fieldErrors?.projectMode).toContain("一栈式");
    }
  });

  it("accepts full-stack mode for one-stack list flow", () => {
    const parsed = parseCreateProjectBody({
      name: "测试项目",
      creationSource: "script-upload",
      projectMode: "full-stack",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
      listFlowKind: "full-stack",
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.projectMode).toBe("full-stack");
    }
  });
});
