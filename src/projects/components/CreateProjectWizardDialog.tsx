"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Check,
  Eye,
  EyeOff,
  FileUp,
  LayoutGrid,
  Layers,
  Sparkles,
  X,
} from "lucide-react";
import { prefersReducedMotion } from "@/shell/login-portal";
import { safeRandomUUID } from "@/lib/safe-random-id";
import type {
  CreateProjectAdvancePayload,
  ProjectCreationSource,
  ProjectMode,
  ProjectPublic,
} from "@/projects/types";
import {
  isCreateProjectReady,
  validateCreateProjectForm,
  type CreateProjectFieldErrors,
} from "@/projects/validate-create-project";
import {
  PROJECT_VISUAL_STYLES,
  isProjectVisualStyleId,
  type ProjectVisualStyleId,
} from "@/projects/project-visual-style";
import { GlassSelect } from "@/shell/glass-select";
import "@/projects/create-project-wizard.css";

type Props = {
  open: boolean;
  onClose: () => void;
  /** 校验通过并创建成功后的类型安全下一步回调 */
  onAdvance: (payload: CreateProjectAdvancePayload) => void;
  returnFocusRef?: RefObject<HTMLButtonElement | null>;
};

type Phase = "form" | "advance";

const INITIAL = {
  creationSource: null as ProjectCreationSource | null,
  name: "",
  approvalEnabled: false,
  passwordEnabled: false,
  projectPassword: "",
  highlights: "",
  visualStyle: null as ProjectVisualStyleId | null,
  projectMode: null as ProjectMode | null,
};

function resetFormState() {
  return {
    ...INITIAL,
    fieldErrors: {} as CreateProjectFieldErrors,
    hasAttemptedSubmit: false,
    showPassword: false,
    bounceSource: null as ProjectCreationSource | null,
    shakeKey: "",
    isSubmitting: false,
    phase: "form" as Phase,
    created: null as ProjectPublic | null,
  };
}

export function CreateProjectWizardDialog({
  open,
  onClose,
  onAdvance,
  returnFocusRef,
}: Props) {
  const router = useRouter();
  const titleId = useId();
  const descId = useId();
  const nameId = useId();
  const passwordId = useId();
  const highlightsId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const idempotencyKeyRef = useRef<string>("");

  const [closing, setClosing] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);
  const [state, setState] = useState(resetFormState);

  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setClosing(false);
      setState(resetFormState());
    }
  }

  useEffect(() => {
    if (open) {
      idempotencyKeyRef.current = "";
    }
  }, [open]);

  const finishClose = useCallback(() => {
    setClosing(false);
    setState(resetFormState());
    onClose();
    window.setTimeout(() => {
      returnFocusRef?.current?.focus();
    }, 0);
  }, [onClose, returnFocusRef]);

  const requestClose = useCallback(() => {
    if (closing || state.isSubmitting) return;
    if (prefersReducedMotion()) {
      finishClose();
      return;
    }
    setClosing(true);
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      finishClose();
    }, 200);
  }, [closing, finishClose, state.isSubmitting]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current != null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    const focusTimer = window.setTimeout(() => {
      closeBtnRef.current?.focus();
    }, 40);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(focusTimer);
    };
  }, [open, requestClose]);

  // 简易 focus trap
  useEffect(() => {
    if (!open) return;
    const root = cardRef.current;
    if (!root) return;
    const onTab = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusables = root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      const list = Array.from(focusables).filter(
        (el) => !el.hasAttribute("disabled") && el.offsetParent !== null,
      );
      if (list.length === 0) return;
      const first = list[0]!;
      const last = list[list.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    root.addEventListener("keydown", onTab);
    return () => root.removeEventListener("keydown", onTab);
  }, [open, state.phase, state.passwordEnabled, state.creationSource]);

  const ready = isCreateProjectReady({
    creationSource: state.creationSource,
    name: state.name,
    projectMode: state.projectMode,
    passwordEnabled: state.passwordEnabled,
    projectPassword: state.projectPassword,
    visualStyle: state.visualStyle,
  });

  const selectSource = (source: ProjectCreationSource) => {
    if (!prefersReducedMotion()) {
      setState((s) => ({ ...s, bounceSource: source }));
      window.setTimeout(() => {
        setState((s) =>
          s.bounceSource === source ? { ...s, bounceSource: null } : s,
        );
      }, 300);
    }
    setState((s) => ({
      ...s,
      creationSource: source,
      fieldErrors: { ...s.fieldErrors, creationSource: undefined },
    }));
  };

  const onSourceKeyDown = (
    e: KeyboardEvent<HTMLButtonElement>,
    source: ProjectCreationSource,
  ) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      selectSource(source === "story" ? "script-upload" : "story");
    }
  };

  const focusFirstError = (errors: CreateProjectFieldErrors) => {
    if (errors.creationSource) {
      setState((s) => ({ ...s, shakeKey: "sources" }));
      return;
    }
    if (errors.name) {
      nameRef.current?.focus();
      setState((s) => ({ ...s, shakeKey: "name" }));
      return;
    }
    if (errors.password) {
      passwordRef.current?.focus();
      setState((s) => ({ ...s, shakeKey: "password" }));
      return;
    }
    if (errors.projectMode) {
      setState((s) => ({ ...s, shakeKey: "modes" }));
      return;
    }
    if (errors.visualStyle) {
      setState((s) => ({ ...s, shakeKey: "visualStyle" }));
    }
  };

  const onNext = async () => {
    if (state.isSubmitting) return;

    const fieldErrors = validateCreateProjectForm({
      creationSource: state.creationSource,
      name: state.name,
      projectMode: state.projectMode,
      passwordEnabled: state.passwordEnabled,
      projectPassword: state.projectPassword,
      highlights: state.highlights,
      visualStyle: state.visualStyle,
    });

    setState((s) => ({
      ...s,
      hasAttemptedSubmit: true,
      fieldErrors,
    }));

    if (Object.keys(fieldErrors).length > 0) {
      focusFirstError(fieldErrors);
      return;
    }

    setState((s) => ({ ...s, isSubmitting: true, fieldErrors: {} }));

    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = safeRandomUUID();
    }

    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: state.name.trim(),
          creationSource: state.creationSource,
          projectMode: state.projectMode,
          highlights: state.highlights,
          visualStyle: state.visualStyle,
          approvalEnabled: state.approvalEnabled,
          passwordEnabled: state.passwordEnabled,
          projectPassword: state.passwordEnabled
            ? state.projectPassword
            : null,
          idempotencyKey: idempotencyKeyRef.current,
        }),
      });
      const payload = (await res.json()) as {
        project?: ProjectPublic;
        rootFolderId?: string;
        error?: string;
        fieldErrors?: CreateProjectFieldErrors;
      };

      if (!res.ok) {
        setState((s) => ({
          ...s,
          isSubmitting: false,
          fieldErrors: payload.fieldErrors ?? {
            name: payload.error ?? "创建失败",
          },
        }));
        if (payload.fieldErrors) focusFirstError(payload.fieldErrors);
        return;
      }

      if (!payload.project || !state.creationSource || !state.projectMode) {
        setState((s) => ({
          ...s,
          isSubmitting: false,
          fieldErrors: { name: "创建失败" },
        }));
        return;
      }

      const advancePayload = {
        project: payload.project,
        creationSource: state.creationSource,
        projectMode: state.projectMode,
      };

      // 清理客户端密码
      setState((s) => ({
        ...s,
        isSubmitting: false,
        projectPassword: "",
        passwordEnabled: false,
        created: payload.project!,
      }));
      idempotencyKeyRef.current = "";

      onAdvance(advancePayload);

      // 创编故事 / 上传剧本：创建成功后进入对应工作台（不停留在占位 advance）
      if (state.creationSource === "story") {
        onClose();
        router.push(
          `/app/projects/${encodeURIComponent(payload.project.projectId)}/story`,
        );
        return;
      }
      if (state.creationSource === "script-upload") {
        onClose();
        router.push(
          `/app/projects/${encodeURIComponent(payload.project.projectId)}/script`,
        );
        return;
      }

      setState((s) => ({
        ...s,
        phase: "advance",
      }));
    } catch {
      setState((s) => ({
        ...s,
        isSubmitting: false,
        fieldErrors: { name: "网络错误，请重试" },
      }));
    }
  };

  if (!open || typeof document === "undefined") return null;

  const formOpen = state.creationSource !== null;
  const errors = state.hasAttemptedSubmit ? state.fieldErrors : {};

  return createPortal(
    <div
      className={`cpw-overlay${closing ? " is-closing" : ""}`}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        ref={cardRef}
        className="cpw-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="cpw-card__glow" aria-hidden />

        <div className="cpw-header">
          <div>
            <h2 id={titleId}>创建新项目</h2>
            <p id={descId}>
              {state.phase === "form"
                ? "选择一个创作起点，并完成项目基础设置"
                : "项目已创建，可进入后续创作步骤"}
            </p>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            className="cpw-close"
            aria-label="关闭创建项目弹窗"
            onClick={requestClose}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="cpw-body">
          {state.phase === "advance" && state.created ? (
            <div className="cpw-advance">
              <h3>{state.created.name}</h3>
              {state.created.creationSource === "story" ? (
                <p>
                  {/* TODO: 接入现有「创编故事」Wizard */}
                  「创编故事」后续流程尚未接入。可先打开项目工作台继续。
                </p>
              ) : (
                <p>
                  {/* TODO: 接入现有「上传剧本」流程 */}
                  「上传剧本」后续流程尚未接入。可先打开项目工作台，或稍后再从项目列表打开。
                </p>
              )}
              <div className="cpw-advance__actions">
                {state.created.projectMode === "canvas" ? (
                  <a
                    className="cpw-next is-ready"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      textDecoration: "none",
                    }}
                    href={`/app/projects/${encodeURIComponent(state.created.projectId)}`}
                  >
                    打开项目工作台
                  </a>
                ) : null}
                <button
                  type="button"
                  className="cpw-next"
                  onClick={requestClose}
                >
                  关闭
                </button>
              </div>
            </div>
          ) : (
            <>
              <div
                className={`cpw-sources${state.shakeKey === "sources" ? " is-shake" : ""}`}
                role="radiogroup"
                aria-label="创作起点"
                aria-describedby={
                  errors.creationSource ? `${titleId}-source-err` : undefined
                }
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={state.creationSource === "story"}
                  className={`cpw-source${
                    state.creationSource === "story" ? " is-selected" : ""
                  }${state.bounceSource === "story" ? " is-bounce" : ""}`}
                  onClick={() => selectSource("story")}
                  onKeyDown={(e) => onSourceKeyDown(e, "story")}
                >
                  {state.creationSource === "story" ? (
                    <span className="cpw-source__check" aria-hidden>
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  ) : null}
                  <span className="cpw-source__icon" aria-hidden>
                    <Sparkles className="h-4 w-4" />
                  </span>
                  <span className="cpw-source__title">创编故事</span>
                  <span className="cpw-source__desc">
                    从灵感、角色和故事大纲开始创作
                  </span>
                </button>

                <button
                  type="button"
                  role="radio"
                  aria-checked={state.creationSource === "script-upload"}
                  className={`cpw-source${
                    state.creationSource === "script-upload"
                      ? " is-selected"
                      : ""
                  }${
                    state.bounceSource === "script-upload" ? " is-bounce" : ""
                  }`}
                  onClick={() => selectSource("script-upload")}
                  onKeyDown={(e) => onSourceKeyDown(e, "script-upload")}
                >
                  {state.creationSource === "script-upload" ? (
                    <span className="cpw-source__check" aria-hidden>
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  ) : null}
                  <span className="cpw-source__icon" aria-hidden>
                    <FileUp className="h-4 w-4" />
                  </span>
                  <span className="cpw-source__title">上传剧本</span>
                  <span className="cpw-source__desc">
                    从已有剧本开始整理分镜和制作流程
                  </span>
                </button>
              </div>
              <div className="cpw-error" id={`${titleId}-source-err`}>
                {errors.creationSource}
              </div>

              <div
                className={`cpw-form-shell${formOpen ? " is-open" : ""}`}
                aria-hidden={!formOpen}
              >
                <div className="cpw-form-shell__inner">
                  <div className="cpw-form">
                    <div className="cpw-field-row cpw-field-row--name-pass">
                      <div className="cpw-field cpw-field--stagger-1">
                        <label className="cpw-label" htmlFor={nameId}>
                          项目名称
                          <span className="cpw-req" aria-hidden>
                            *
                          </span>
                        </label>
                        <input
                          ref={nameRef}
                          id={nameId}
                          className={`cpw-input${errors.name ? " is-invalid" : ""}${
                            state.shakeKey === "name" ? " is-shake" : ""
                          }`}
                          placeholder="请输入项目名称"
                          value={state.name}
                          aria-invalid={Boolean(errors.name)}
                          aria-describedby={`${nameId}-err`}
                          onChange={(e) =>
                            setState((s) => ({
                              ...s,
                              name: e.target.value,
                              fieldErrors: { ...s.fieldErrors, name: undefined },
                            }))
                          }
                          onBlur={() => {
                            if (!state.hasAttemptedSubmit) return;
                            const next = validateCreateProjectForm({
                              creationSource: state.creationSource,
                              name: state.name,
                              projectMode: state.projectMode,
                              passwordEnabled: state.passwordEnabled,
                              projectPassword: state.projectPassword,
                              highlights: state.highlights,
                              visualStyle: state.visualStyle,
                            });
                            setState((s) => ({
                              ...s,
                              fieldErrors: {
                                ...s.fieldErrors,
                                name: next.name,
                              },
                            }));
                          }}
                        />
                        <div className="cpw-error" id={`${nameId}-err`}>
                          {errors.name}
                        </div>
                      </div>

                      <div className="cpw-field cpw-field--stagger-2 cpw-field--password">
                        <label className="cpw-check">
                          <input
                            type="checkbox"
                            checked={state.passwordEnabled}
                            onChange={(e) => {
                              const enabled = e.target.checked;
                              setState((s) => ({
                                ...s,
                                passwordEnabled: enabled,
                                projectPassword: enabled ? s.projectPassword : "",
                                fieldErrors: {
                                  ...s.fieldErrors,
                                  password: undefined,
                                },
                              }));
                            }}
                          />
                          设置项目访问密码
                        </label>
                        {state.passwordEnabled ? (
                          <>
                            <div className="cpw-password-row">
                              <input
                                ref={passwordRef}
                                id={passwordId}
                                type={state.showPassword ? "text" : "password"}
                                className={`cpw-input${
                                  errors.password ? " is-invalid" : ""
                                }`}
                                placeholder="请输入项目访问密码"
                                value={state.projectPassword}
                                autoComplete="new-password"
                                aria-invalid={Boolean(errors.password)}
                                aria-describedby={`${passwordId}-err`}
                                onChange={(e) =>
                                  setState((s) => ({
                                    ...s,
                                    projectPassword: e.target.value,
                                    fieldErrors: {
                                      ...s.fieldErrors,
                                      password: undefined,
                                    },
                                  }))
                                }
                              />
                              <button
                                type="button"
                                className="cpw-eye"
                                aria-label={
                                  state.showPassword ? "隐藏密码" : "显示密码"
                                }
                                onClick={() =>
                                  setState((s) => ({
                                    ...s,
                                    showPassword: !s.showPassword,
                                  }))
                                }
                              >
                                {state.showPassword ? (
                                  <EyeOff className="h-4 w-4" aria-hidden />
                                ) : (
                                  <Eye className="h-4 w-4" aria-hidden />
                                )}
                              </button>
                            </div>
                            <div className="cpw-error" id={`${passwordId}-err`}>
                              {errors.password}
                            </div>
                          </>
                        ) : null}
                      </div>
                    </div>

                    <div
                      className={`cpw-field cpw-field--stagger-3${
                        state.shakeKey === "visualStyle" ? " is-shake" : ""
                      }`}
                    >
                      <div className="cpw-label-row">
                        <label className="cpw-label" htmlFor="cpw-visual-style">
                          生成风格
                          <span className="cpw-req" aria-hidden>
                            *
                          </span>
                        </label>
                        <span className="cpw-hint">必选，影响后续全部生成</span>
                      </div>
                      <div data-testid="cpw-visual-style">
                        <GlassSelect
                          id="cpw-visual-style"
                          label="生成风格"
                          hideLabel
                          menuPortal
                          placeholder="请选择项目生成风格"
                          value={state.visualStyle ?? ""}
                          options={PROJECT_VISUAL_STYLES.map((style) => ({
                            id: style.id,
                            label: style.label,
                          }))}
                          onChange={(id) =>
                            setState((s) => ({
                              ...s,
                              visualStyle: isProjectVisualStyleId(id)
                                ? id
                                : null,
                              fieldErrors: {
                                ...s.fieldErrors,
                                visualStyle: undefined,
                              },
                            }))
                          }
                        />
                      </div>
                      <div className="cpw-error" data-testid="cpw-visual-style-error">
                        {errors.visualStyle}
                      </div>
                    </div>

                    <div className="cpw-field cpw-field--stagger-4">
                      <div className="cpw-label">
                        选择模式
                        <span className="cpw-req" aria-hidden>
                          *
                        </span>
                      </div>
                      <div
                        className={`cpw-modes${
                          state.shakeKey === "modes" ? " is-shake" : ""
                        }`}
                        role="radiogroup"
                        aria-label="项目模式"
                        aria-describedby={`${titleId}-mode-err`}
                      >
                        <button
                          type="button"
                          role="radio"
                          aria-checked={state.projectMode === "canvas"}
                          className={`cpw-mode${
                            state.projectMode === "canvas" ? " is-selected" : ""
                          }`}
                          onClick={() =>
                            setState((s) => ({
                              ...s,
                              projectMode: "canvas",
                              fieldErrors: {
                                ...s.fieldErrors,
                                projectMode: undefined,
                              },
                            }))
                          }
                        >
                          <span className="cpw-mode__title">
                            <LayoutGrid className="h-4 w-4" aria-hidden />
                            画布模式
                          </span>
                          <span className="cpw-mode__desc">
                            使用节点画布自由搭建视频创作流程
                          </span>
                        </button>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={state.projectMode === "full-stack"}
                          className={`cpw-mode${
                            state.projectMode === "full-stack"
                              ? " is-selected"
                              : ""
                          }`}
                          onClick={() =>
                            setState((s) => ({
                              ...s,
                              projectMode: "full-stack",
                              fieldErrors: {
                                ...s.fieldErrors,
                                projectMode: undefined,
                              },
                            }))
                          }
                        >
                          <span className="cpw-mode__title">
                            <Layers className="h-4 w-4" aria-hidden />
                            全栈模式
                            <span className="cpw-badge">推荐</span>
                          </span>
                          <span className="cpw-mode__desc">
                            从故事、分镜、素材到视频生成的一体化创作流程
                          </span>
                        </button>
                      </div>
                      <div className="cpw-error" id={`${titleId}-mode-err`}>
                        {errors.projectMode}
                      </div>
                    </div>

                    <div className="cpw-field cpw-field--stagger-4">
                      <label className="cpw-check cpw-approval-option">
                        <input
                          type="checkbox"
                          checked={state.approvalEnabled}
                          onChange={(event) =>
                            setState((current) => ({
                              ...current,
                              approvalEnabled: event.target.checked,
                            }))
                          }
                        />
                        <span>
                          <strong>审批系统</strong>
                          <small>若勾选则加入项目的审批系统</small>
                        </span>
                      </label>
                      <p className="cpw-approval-hint">
                        默认关闭；关闭后所有协作者共享一致的创作权限。
                      </p>
                    </div>

                    <div className="cpw-field cpw-field--stagger-4">
                      <div className="cpw-label-row">
                        <label className="cpw-label" htmlFor={highlightsId}>
                          项目要点
                        </label>
                        <span className="cpw-hint">
                          可选，仅项目主理人可以修改
                        </span>
                      </div>
                      <textarea
                        id={highlightsId}
                        className="cpw-textarea"
                        placeholder="填写故事方向、人物关系、制作要求或其他重要信息"
                        value={state.highlights}
                        rows={2}
                        onChange={(e) =>
                          setState((s) => ({
                            ...s,
                            highlights: e.target.value,
                          }))
                        }
                      />
                      <div className="cpw-error">
                        {errors.highlights}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {state.phase === "form" ? (
          <div className="cpw-footer">
            <button
              type="button"
              className={`cpw-next${ready ? " is-ready" : ""}`}
              aria-disabled={!ready}
              disabled={state.isSubmitting}
              onClick={() => void onNext()}
            >
              {state.isSubmitting ? "创建中…" : "下一步"}
            </button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
