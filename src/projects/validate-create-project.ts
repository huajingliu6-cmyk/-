import type {
  CreateProjectInput,
  ProjectCreationSource,
  ProjectMode,
} from "@/projects/types";

export type CreateProjectFieldErrors = {
  creationSource?: string;
  name?: string;
  password?: string;
  projectMode?: string;
  highlights?: string;
};

/** 与后端一致的名称约束（避免前后端冲突） */
export const PROJECT_NAME_MAX_LENGTH = 80;
export const PROJECT_HIGHLIGHTS_MAX_LENGTH = 4000;

export function isCreateProjectReady(input: {
  creationSource: ProjectCreationSource | null;
  name: string;
  projectMode: ProjectMode | null;
  passwordEnabled: boolean;
  projectPassword: string;
}): boolean {
  return (
    input.creationSource !== null &&
    input.name.trim().length > 0 &&
    input.projectMode !== null &&
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

  const passwordEnabled = Boolean(raw.passwordEnabled);
  const projectPassword =
    typeof raw.projectPassword === "string" ? raw.projectPassword : "";
  const highlights =
    typeof raw.highlights === "string"
      ? raw.highlights
      : typeof raw.projectHighlights === "string"
        ? raw.projectHighlights
        : "";

  const fieldErrors = validateCreateProjectForm({
    creationSource,
    name,
    projectMode,
    passwordEnabled,
    projectPassword,
    highlights,
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
      "校验失败";
    return { ok: false, error: first, fieldErrors };
  }

  return {
    ok: true,
    value: {
      name: name.trim(),
      creationSource,
      projectMode,
      highlights: highlights.trim(),
      passwordEnabled,
      projectPassword: passwordEnabled ? projectPassword : null,
    },
  };
}
