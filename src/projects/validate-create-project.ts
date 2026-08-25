import type {
  CreateProjectInput,
  ProjectCreationSource,
  ProjectMode,
} from "@/projects/types";
import {
  isProjectVisualStyleId,
  type ProjectVisualStyleId,
} from "@/projects/project-visual-style";

import type { ProjectFlowKind } from "@/projects/project-flow";

export type CreateProjectFieldErrors = {
  creationSource?: string;
  name?: string;
  password?: string;
  projectMode?: string;
  highlights?: string;
  visualStyle?: string;
};

/** 与后端一致的名称约束（避免前后端冲突） */
export const PROJECT_NAME_MAX_LENGTH = 80;
export const PROJECT_HIGHLIGHTS_MAX_LENGTH = 4000;

const FLOW_KIND_MODES: Record<ProjectFlowKind, ProjectMode> = {
  "full-stack": "full-stack",
  canvas: "canvas",
};

export function projectModeForFlowKind(flowKind: ProjectFlowKind): ProjectMode {
  return FLOW_KIND_MODES[flowKind];
}

export function isCreateProjectReady(input: {
  creationSource: ProjectCreationSource | null;
  name: string;
  projectMode: ProjectMode | null;
  passwordEnabled: boolean;
  projectPassword: string;
  visualStyle: ProjectVisualStyleId | null;
}): boolean {
  return (
    input.creationSource !== null &&
    input.name.trim().length > 0 &&
    input.projectMode !== null &&
    input.visualStyle !== null &&
    (!input.passwordEnabled || input.projectPassword.trim().length > 0)
  );
}

export function validateCreateProjectForm(input: {
  creationSource: ProjectCreationSource | null;
  name: string;
  projectMode: ProjectMode | null;
  passwordEnabled: boolean;
  projectPassword: string;
  highlights: string;
  visualStyle: ProjectVisualStyleId | null;
}): CreateProjectFieldErrors {
  const errors: CreateProjectFieldErrors = {};

  if (!input.creationSource) {
    errors.creationSource = "请选择创编故事或上传剧本";
  }

  const name = input.name.trim();
  if (!name) {
    errors.name = "请输入项目名称";
  } else if (name.length > PROJECT_NAME_MAX_LENGTH) {
    errors.name = `项目名称不能超过 ${PROJECT_NAME_MAX_LENGTH} 个字符`;
  }

  if (input.passwordEnabled && !input.projectPassword.trim()) {
    errors.password = "已启用项目密码，请填写项目访问密码";
  }

  if (!input.projectMode) {
    errors.projectMode = "请选择项目模式";
  }

  if (!input.visualStyle) {
    errors.visualStyle = "请选择项目生成风格";
  } else if (!isProjectVisualStyleId(input.visualStyle)) {
    errors.visualStyle = "请选择项目生成风格";
  }

  if (input.highlights.length > PROJECT_HIGHLIGHTS_MAX_LENGTH) {
    errors.highlights = `项目要点不能超过 ${PROJECT_HIGHLIGHTS_MAX_LENGTH} 个字符`;
  }

  return errors;
}

export function parseCreateProjectBody(
  body: unknown,
):
  | { ok: true; value: CreateProjectInput }
  | { ok: false; error: string; fieldErrors?: CreateProjectFieldErrors } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "无效请求" };
  }
  const raw = body as Record<string, unknown>;

  if (
    "stylePrompt" in raw ||
    "promptDirective" in raw ||
    "styleDirective" in raw
  ) {
    return {
      ok: false,
      error: "不允许客户端覆盖项目视觉风格指令",
    };
  }

  const creationSource = raw.creationSource;
  if (creationSource !== "story" && creationSource !== "script-upload") {
    return {
      ok: false,
      error: "请选择创编故事或上传剧本",
      fieldErrors: { creationSource: "请选择创编故事或上传剧本" },
    };
  }

  const name =
    typeof raw.name === "string"
      ? raw.name
      : typeof raw.projectName === "string"
        ? raw.projectName
        : "";
  const projectMode = raw.projectMode;
  if (projectMode !== "canvas" && projectMode !== "full-stack") {
    return {
      ok: false,
      error: "请选择项目模式",
      fieldErrors: { projectMode: "请选择项目模式" },
    };
  }

  const listFlowKind = raw.listFlowKind;
  if (
    listFlowKind === "full-stack" ||
    listFlowKind === "canvas"
  ) {
    const expectedMode = projectModeForFlowKind(listFlowKind);
    if (projectMode !== expectedMode) {
      return {
        ok: false,
        error: "项目模式与创建入口不一致",
        fieldErrors: {
          projectMode:
            listFlowKind === "full-stack"
              ? "一栈式项目必须使用一栈式模式"
              : "画布项目必须使用画布模式",
        },
      };
    }
  } else if (listFlowKind != null && listFlowKind !== "") {
    return { ok: false, error: "无效的项目创建入口" };
  }

  const passwordEnabled = Boolean(raw.passwordEnabled);
  const approvalEnabled = raw.approvalEnabled === true;
  const projectPassword =
    typeof raw.projectPassword === "string" ? raw.projectPassword : "";
  const highlights =
    typeof raw.highlights === "string"
      ? raw.highlights
      : typeof raw.projectHighlights === "string"
        ? raw.projectHighlights
        : "";

  const visualStyleRaw = raw.visualStyle;
  const visualStyle = isProjectVisualStyleId(visualStyleRaw)
    ? visualStyleRaw
    : null;

  const fieldErrors = validateCreateProjectForm({
    creationSource,
    name,
    projectMode,
    passwordEnabled,
    projectPassword,
    highlights,
    visualStyle,
  });

  if (highlights.length > PROJECT_HIGHLIGHTS_MAX_LENGTH) {
    return {
      ok: false,
      error: `项目要点不能超过 ${PROJECT_HIGHLIGHTS_MAX_LENGTH} 个字符`,
    };
  }

  if (Object.keys(fieldErrors).length > 0) {
    const first =
      fieldErrors.creationSource ||
      fieldErrors.name ||
      fieldErrors.password ||
      fieldErrors.projectMode ||
      fieldErrors.visualStyle ||
      "校验失败";
    return { ok: false, error: first, fieldErrors };
  }

  if (!visualStyle) {
    return {
      ok: false,
      error: "请选择项目生成风格",
      fieldErrors: { visualStyle: "请选择项目生成风格" },
    };
  }

  return {
    ok: true,
    value: {
      name: name.trim(),
      creationSource,
      projectMode,
      highlights: highlights.trim(),
      visualStyle,
      approvalEnabled,
      passwordEnabled,
      projectPassword: passwordEnabled ? projectPassword : null,
    },
  };
}
