"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  convertNovelToScript,
  exportDocuments,
  switchToScriptMode,
} from "@/projects/story/api-stubs";
import {
  countVisibleChars,
  EPISODE_LENGTH_OPTIONS,
  STORY_BRIEF_MAX_CHARS,
  STORY_TARGET_CHARS_DEFAULT,
  STORY_TARGET_CHARS_MAX,
  STORY_TARGET_CHARS_MIN,
  STORY_TEXT_MODELS,
  MOCK_TEXT_MODELS,
} from "@/projects/story/constants";
import { ExportDialog } from "@/projects/story/ExportDialog";
import { GenerationHistoryPanel } from "@/projects/story/GenerationHistoryPanel";
import { GenerationResultPanel } from "@/projects/story/GenerationResultPanel";
import { MOCK_GENERATION_HISTORY } from "@/projects/story/mock-data";
import { StoryGenerationPreview } from "@/projects/story/StoryGenerationPreview";
import { ScriptOutlineGenerationPreview } from "@/projects/story/ScriptOutlineGenerationPreview";
import { ScriptEpisodesGenerationPreview } from "@/projects/story/ScriptEpisodesGenerationPreview";
import { StoryInputPanel } from "@/projects/story/StoryInputPanel";
import {
  cancelStoryGeneration,
  createScriptEpisodesIdempotencyKey,
  createScriptOutlineIdempotencyKey,
  createStoryGenerationIdempotencyKey,
  notifyCreditsRefresh,
  streamStoryGeneration,
  StoryGenerationClientError,
  type StoryGenerationStreamResult,
} from "@/projects/story/story-generation-client";
import {
  assertSafeStoryGenerationRequest,
  buildStoryGenerationRequest,
} from "@/projects/story/story-generation-prompt";
import {
  assertSafeScriptOutlineGenerationRequest,
  buildScriptOutlineGenerationRequest,
  SCRIPT_OUTLINE_TARGET_CHARS_DEFAULT,
} from "@/projects/story/script-outline-generation-prompt";
import {
  assertSafeScriptEpisodesGenerationRequest,
  buildScriptEpisodesGenerationRequest,
} from "@/projects/story/script-episodes-generation-prompt";
import {
  outlineContentFingerprint,
  parseScriptEpisodesGenerationOutput,
  type ScriptEpisodesGenerationDto,
} from "@/projects/script/script-episodes-generation-schema";
import type {
  EpisodeLengthOption,
  GenerationHistoryItem,
  ScriptWorkflowMode,
  StoryOutputType,
} from "@/projects/story/types";
import { ConfirmLeaveDialog } from "@/shell/ConfirmLeaveDialog";
import { useChipBounce } from "@/shell/useChipBounce";
import { useGenerationBusy } from "@/shell/GenerationBusyGuard";
import { registerUnsavedLeaveHandler } from "@/shell/unsaved-leave";
import "@/projects/story/story-workspace.css";

type PreviewKind = "story" | "outline" | "episodes" | null;

type Props = {
  projectId: string;
};

type WorkspaceSnapshot = {
  brief: string;
  outputType: StoryOutputType;
  modelId: string;
  targetChars: number;
  resultText: string;
  scriptMode: ScriptWorkflowMode;
  episodeNumber: number;
  episodeLength: EpisodeLengthOption;
};

function clampTargetChars(n: number): number {
  if (!Number.isFinite(n)) return STORY_TARGET_CHARS_DEFAULT;
  const int = Math.trunc(n);
  return Math.min(
    STORY_TARGET_CHARS_MAX,
    Math.max(STORY_TARGET_CHARS_MIN, int),
  );
}

function toSnapshot(state: WorkspaceSnapshot): string {
  return JSON.stringify(state);
}

function isEpisodeLength(n: number): n is EpisodeLengthOption {
  return (EPISODE_LENGTH_OPTIONS as readonly number[]).includes(n);
}

function resolveModelId(modelKey: string | undefined): string {
  const storyFallback = STORY_TEXT_MODELS[0]?.id ?? "balanced-default";
  if (!modelKey) return storyFallback;
  if (STORY_TEXT_MODELS.some((m) => m.id === modelKey)) return modelKey;
  if (MOCK_TEXT_MODELS.some((m) => m.id === modelKey)) return modelKey;
  return storyFallback;
}

export function StoryCreationWorkspace({ projectId }: Props) {
  const [projectName, setProjectName] = useState("");
  const [loadError, setLoadError] = useState("");
  const [brief, setBrief] = useState("");
  const [outputType, setOutputType] = useState<StoryOutputType>("story");
  const [modelId, setModelId] = useState(STORY_TEXT_MODELS[0]?.id ?? "");
  const [targetChars, setTargetChars] = useState(STORY_TARGET_CHARS_DEFAULT);
  const [scriptMode, setScriptMode] = useState<ScriptWorkflowMode>(null);
  const [episodeNumber, setEpisodeNumber] = useState(1);
  const [episodeLength, setEpisodeLength] =
    useState<EpisodeLengthOption>(500);
  const [resultText, setResultText] = useState("");
  const [outlineText, setOutlineText] = useState("");
  const [showContinueGenerate, setShowContinueGenerate] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [selectedExportIds, setSelectedExportIds] = useState<string[]>([]);
  const [historyItems] = useState<GenerationHistoryItem[]>(
    () => MOCK_GENERATION_HISTORY,
  );
  const [uiNote, setUiNote] = useState("");
  const [generating, setGenerating] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewKind, setPreviewKind] = useState<PreviewKind>(null);
  const [previewResult, setPreviewResult] =
    useState<StoryGenerationStreamResult | null>(null);
  const [previewStreamText, setPreviewStreamText] = useState("");
  const [applyingPreview, setApplyingPreview] = useState(false);
  const [applyError, setApplyError] = useState("");
  const [episodesParsed, setEpisodesParsed] =
    useState<ScriptEpisodesGenerationDto | null>(null);
  const [episodesParseError, setEpisodesParseError] = useState("");
  const [hasFormalEpisodes, setHasFormalEpisodes] = useState(false);
  const [previewTargetEpisodeNumber, setPreviewTargetEpisodeNumber] =
    useState(1);
  const [savedSnapshot, setSavedSnapshot] = useState(() =>
    toSnapshot({
      brief: "",
      outputType: "story",
      modelId: STORY_TEXT_MODELS[0]?.id ?? "",
      targetChars: STORY_TARGET_CHARS_DEFAULT,
      resultText: "",
      scriptMode: null,
      episodeNumber: 1,
      episodeLength: 500,
    }),
  );
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [leaveOpen, setLeaveOpen] = useState(false);
  const leaveResolveRef = useRef<((ok: boolean) => void) | null>(null);
  const saveBounce = useChipBounce();
  useGenerationBusy(generating, `story-gen-${projectId}`, "故事/大纲/分集生成");
  const generatingLockRef = useRef(false);
  const applyLockRef = useRef(false);
  const activeIdempotencyRef = useRef<string | null>(null);
  const activeGenerationIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const projectIdRef = useRef(projectId);
  const episodesGenContextRef = useRef<{
    outlineFingerprint: string;
    draftUpdatedAt: string;
    episodeNumber: number;
  } | null>(null);

  useEffect(() => {
    projectIdRef.current = projectId;
  }, [projectId]);

  const currentSnapshot = useMemo(
    () =>
      toSnapshot({
        brief,
        outputType,
        modelId,
        targetChars,
        resultText,
        scriptMode,
        episodeNumber,
        episodeLength,
      }),
    [
      brief,
      outputType,
      modelId,
      targetChars,
      resultText,
      scriptMode,
      episodeNumber,
      episodeLength,
    ],
  );

  const dirty = currentSnapshot !== savedSnapshot;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/story-draft`,
        );
        if (!res.ok) {
          if (!cancelled) {
            setLoadError("无法加载项目草稿");
            // 仍尝试取项目名
            const meta = await fetch(
              `/api/projects/${encodeURIComponent(projectId)}`,
            );
            if (meta.ok) {
              const data = (await meta.json()) as {
                project?: { name?: string };
              };
              setProjectName(data.project?.name ?? "");
            }
          }
          return;
        }
        const data = (await res.json()) as {
          project?: { name?: string };
          draft?: {
            brief?: string;
            outputKind?: StoryOutputType;
            modelKey?: string;
            targetChars?: number;
            resultText?: string;
            scriptMode?: ScriptWorkflowMode;
            episodeNumber?: number;
            episodeLength?: number;
          };
          currentDocument?: { content?: string } | null;
        };
        if (cancelled) return;

        const draft = data.draft;
        const nextBrief = draft?.brief ?? "";
        const nextOutput: StoryOutputType =
          draft?.outputKind === "script" ? "script" : "story";
        const nextModel = resolveModelId(draft?.modelKey);
        const nextTarget = clampTargetChars(
          typeof draft?.targetChars === "number"
            ? draft.targetChars
            : STORY_TARGET_CHARS_DEFAULT,
        );
        const nextResult =
          draft?.resultText ?? data.currentDocument?.content ?? "";
        const nextScriptMode: ScriptWorkflowMode =
          draft?.scriptMode === "discuss-outline" ||
          draft?.scriptMode === "direct-episode"
            ? draft.scriptMode
            : null;
        const nextEpisode =
          typeof draft?.episodeNumber === "number" &&
          draft.episodeNumber >= 1 &&
          draft.episodeNumber <= 8
            ? draft.episodeNumber
            : 1;
        const nextLen =
          typeof draft?.episodeLength === "number" &&
          isEpisodeLength(draft.episodeLength)
            ? draft.episodeLength
            : 500;

        setProjectName(data.project?.name ?? "");
        setBrief(nextBrief);
        setOutputType(nextOutput);
        setModelId(nextModel);
        setTargetChars(nextTarget);
        setResultText(nextResult);
        setScriptMode(nextScriptMode);
        setEpisodeNumber(nextEpisode);
        setEpisodeLength(nextLen);

        // Load script-draft outline separately (planning text, not story result).
        try {
          const scriptRes = await fetch(
            `/api/projects/${encodeURIComponent(projectId)}/script-draft`,
            { credentials: "include" },
          );
          if (scriptRes.ok) {
            const scriptData = (await scriptRes.json()) as {
              draft?: {
                outlineText?: string | null;
                episodes?: unknown[];
              };
            };
            const nextOutline =
              typeof scriptData.draft?.outlineText === "string"
                ? scriptData.draft.outlineText
                : "";
            setOutlineText(nextOutline);
            setHasFormalEpisodes(
              Array.isArray(scriptData.draft?.episodes) &&
                scriptData.draft.episodes.length > 0,
            );
          } else {
            setOutlineText("");
          }
        } catch {
          setOutlineText("");
        }

        setSavedSnapshot(
          toSnapshot({
            brief: nextBrief,
            outputType: nextOutput,
            modelId: nextModel,
            targetChars: nextTarget,
            resultText: nextResult,
            scriptMode: nextScriptMode,
            episodeNumber: nextEpisode,
            episodeLength: nextLen,
          }),
        );
        setLoadError("");
      } catch {
        if (!cancelled) setLoadError("无法加载项目草稿");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    return registerUnsavedLeaveHandler(async () => {
      if (generating) return false;
      if (!dirty) return true;
      setLeaveOpen(true);
      return await new Promise<boolean>((resolve) => {
        leaveResolveRef.current = resolve;
      });
    });
  }, [dirty, generating]);

  const handleSave = useCallback(async () => {
    const visible = countVisibleChars(brief);
    if (visible > STORY_BRIEF_MAX_CHARS) {
      setSaveState("error");
      setUiNote("输入内容最多1500字，请缩短后再保存。");
      return;
    }
    const chars = clampTargetChars(targetChars);
    setTargetChars(chars);
    setSaveState("saving");
    setUiNote("");
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/story-draft`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            brief,
            outputKind: outputType,
            modelKey: modelId,
            targetChars: chars,
            resultText,
            scriptMode,
            episodeNumber,
            episodeLength,
          }),
        },
      );
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(payload.error ?? "保存失败");
      }
      const snap = toSnapshot({
        brief,
        outputType,
        modelId,
        targetChars: chars,
        resultText,
        scriptMode,
        episodeNumber,
        episodeLength,
      });
      setSavedSnapshot(snap);
      setSaveState("saved");
      setUiNote("页面已保存。");
    } catch (err) {
      setSaveState("error");
      setUiNote(err instanceof Error ? err.message : "保存失败");
    }
  }, [
    brief,
    episodeLength,
    episodeNumber,
    modelId,
    outputType,
    projectId,
    resultText,
    scriptMode,
    targetChars,
  ]);

  const handleGenerate = useCallback(() => {
    const visible = countVisibleChars(brief);
    if (visible > STORY_BRIEF_MAX_CHARS) return;

    if (outputType === "story") {
      if (visible === 0) return;
      if (generatingLockRef.current) return;
      const chars = clampTargetChars(targetChars);
      setTargetChars(chars);
      const modelKey = resolveModelId(modelId);
      setModelId(modelKey);
      const idempotencyKey =
        activeIdempotencyRef.current ?? createStoryGenerationIdempotencyKey();
      activeIdempotencyRef.current = idempotencyKey;
      const requestBody = buildStoryGenerationRequest({
        brief,
        modelKey,
        targetChars: chars,
        idempotencyKey,
      });
      try {
        assertSafeStoryGenerationRequest(requestBody);
      } catch (err) {
        setUiNote(err instanceof Error ? err.message : "请求校验失败");
        return;
      }

      generatingLockRef.current = true;
      setGenerating(true);
      setUiNote("正在生成故事…");
      setPreviewOpen(false);
      setPreviewKind(null);
      setPreviewResult(null);
      setPreviewStreamText("");
      setApplyError("");
      const startedForProject = projectId;
      const controller = new AbortController();
      abortRef.current = controller;

      void streamStoryGeneration({
        projectId,
        brief,
        modelKey,
        targetChars: chars,
        idempotencyKey,
        signal: controller.signal,
        onMeta: (meta) => {
          activeGenerationIdRef.current = meta.generationId;
        },
        onDelta: (accumulated) => {
          if (projectIdRef.current !== startedForProject) return;
          setPreviewStreamText(accumulated);
        },
      })
        .then((result) => {
          if (projectIdRef.current !== startedForProject) return;
          setPreviewResult(result);
          setPreviewStreamText(result.text);
          setPreviewKind("story");
          setPreviewOpen(true);
          setUiNote("生成完成，请确认预览后再应用到草稿。");
          notifyCreditsRefresh();
        })
        .catch((err: unknown) => {
          if (projectIdRef.current !== startedForProject) return;
          if (controller.signal.aborted) {
            setUiNote("已取消生成。");
            return;
          }
          const msg =
            err instanceof StoryGenerationClientError
              ? err.message
              : err instanceof Error
                ? err.message
                : "生成失败";
          setUiNote(msg);
          setPreviewOpen(false);
          setPreviewKind(null);
          setPreviewResult(null);
          notifyCreditsRefresh();
        })
        .finally(() => {
          if (projectIdRef.current === startedForProject) {
            generatingLockRef.current = false;
            setGenerating(false);
            activeIdempotencyRef.current = null;
            abortRef.current = null;
          }
        });
      return;
    }

    if (scriptMode === "discuss-outline") {
      if (visible === 0) return;
      if (generatingLockRef.current) return;
      const modelKey = resolveModelId(modelId);
      setModelId(modelKey);
      const idempotencyKey =
        activeIdempotencyRef.current ?? createScriptOutlineIdempotencyKey();
      activeIdempotencyRef.current = idempotencyKey;
      const requestBody = buildScriptOutlineGenerationRequest({
        brief,
        modelKey,
        targetChars: SCRIPT_OUTLINE_TARGET_CHARS_DEFAULT,
        idempotencyKey,
      });
      try {
        assertSafeScriptOutlineGenerationRequest(requestBody);
      } catch (err) {
        setUiNote(err instanceof Error ? err.message : "请求校验失败");
        return;
      }

      generatingLockRef.current = true;
      setGenerating(true);
      setUiNote("正在生成剧本大纲…");
      setPreviewOpen(false);
      setPreviewKind(null);
      setPreviewResult(null);
      setPreviewStreamText("");
      setApplyError("");
      const startedForProject = projectId;
      const controller = new AbortController();
      abortRef.current = controller;

      void streamStoryGeneration({
        projectId,
        brief,
        modelKey,
        targetChars: requestBody.targetChars,
        idempotencyKey,
        outputKind: "script_outline",
        signal: controller.signal,
        onMeta: (meta) => {
          activeGenerationIdRef.current = meta.generationId;
        },
        onDelta: (accumulated) => {
          if (projectIdRef.current !== startedForProject) return;
          setPreviewStreamText(accumulated);
        },
      })
        .then((result) => {
          if (projectIdRef.current !== startedForProject) return;
          setPreviewResult(result);
          setPreviewStreamText(result.text);
          setPreviewKind("outline");
          setPreviewOpen(true);
          setUiNote("大纲生成完成，请确认预览后再应用到大纲。");
          notifyCreditsRefresh();
        })
        .catch((err: unknown) => {
          if (projectIdRef.current !== startedForProject) return;
          if (controller.signal.aborted) {
            setUiNote("已取消大纲生成。");
            return;
          }
          const msg =
            err instanceof StoryGenerationClientError
              ? err.message
              : err instanceof Error
                ? err.message
                : "大纲生成失败";
          setUiNote(msg);
          setPreviewOpen(false);
          setPreviewKind(null);
          setPreviewResult(null);
          notifyCreditsRefresh();
        })
        .finally(() => {
          if (projectIdRef.current === startedForProject) {
            generatingLockRef.current = false;
            setGenerating(false);
            activeIdempotencyRef.current = null;
            abortRef.current = null;
          }
        });
      return;
    }

    if (scriptMode === "direct-episode") {
      if (generatingLockRef.current) return;
      const modelKey = resolveModelId(modelId);
      setModelId(modelKey);
      const startedForProject = projectId;
      const controller = new AbortController();
      abortRef.current = controller;

      generatingLockRef.current = true;
      setGenerating(true);
      setUiNote("正在校验已保存大纲…");
      setPreviewOpen(false);
      setPreviewKind(null);
      setPreviewResult(null);
      setPreviewStreamText("");
      setEpisodesParsed(null);
      setEpisodesParseError("");
      setApplyError("");

      void (async () => {
        try {
          const getRes = await fetch(
            `/api/projects/${encodeURIComponent(startedForProject)}/script-draft`,
            { credentials: "include", signal: controller.signal },
          );
          if (!getRes.ok) {
            throw new Error("无法读取剧本草稿");
          }
          const getPayload = (await getRes.json()) as {
            draft?: {
              outlineText?: string | null;
              updatedAt?: string;
              episodes?: unknown[];
            } | null;
          };
          const savedOutline =
            typeof getPayload.draft?.outlineText === "string"
              ? getPayload.draft.outlineText
              : "";
          if (!savedOutline.trim()) {
            throw new Error("请先保存大纲后再生成剧集。");
          }
          if (
            outlineContentFingerprint(outlineText) !==
            outlineContentFingerprint(savedOutline)
          ) {
            throw new Error(
              "请先保存或应用当前大纲，再生成剧集。",
            );
          }
          setHasFormalEpisodes(
            Array.isArray(getPayload.draft?.episodes) &&
              (getPayload.draft?.episodes.length ?? 0) > 0,
          );

          const idempotencyKey =
            activeIdempotencyRef.current ??
            createScriptEpisodesIdempotencyKey();
          activeIdempotencyRef.current = idempotencyKey;
          const requestBody = buildScriptEpisodesGenerationRequest({
            brief,
            outlineText: savedOutline,
            episodeNumber,
            modelKey,
            targetChars: episodeLength,
            idempotencyKey,
          });
          assertSafeScriptEpisodesGenerationRequest(requestBody);

          episodesGenContextRef.current = {
            outlineFingerprint: outlineContentFingerprint(savedOutline),
            draftUpdatedAt:
              typeof getPayload.draft?.updatedAt === "string"
                ? getPayload.draft.updatedAt
                : "",
            episodeNumber,
          };
          setPreviewTargetEpisodeNumber(episodeNumber);

          setUiNote("正在根据大纲生成剧集…");
          const result = await streamStoryGeneration({
            projectId: startedForProject,
            brief: requestBody.brief,
            outlineText: requestBody.outlineText,
            episodeNumber: requestBody.episodeNumber,
            modelKey,
            targetChars: requestBody.targetChars,
            idempotencyKey,
            outputKind: "script_episodes",
            signal: controller.signal,
            onMeta: (meta) => {
              activeGenerationIdRef.current = meta.generationId;
            },
            onDelta: (accumulated) => {
              if (projectIdRef.current !== startedForProject) return;
              setPreviewStreamText(accumulated);
            },
          });

          if (projectIdRef.current !== startedForProject) return;
          setPreviewResult(result);
          setPreviewStreamText(result.text);
          const parsed = parseScriptEpisodesGenerationOutput(result.text, {
            expectedCount: 1,
            expectedEpisodeNumber: episodeNumber,
          });
          if (parsed.ok) {
            setEpisodesParsed(parsed.value);
            setEpisodesParseError("");
            setUiNote("剧集生成完成，请确认预览后再应用到正式剧本。");
          } else {
            setEpisodesParsed(null);
            setEpisodesParseError(parsed.message);
            setUiNote(`结构化输出校验失败：${parsed.message}`);
          }
          setPreviewKind("episodes");
          setPreviewOpen(true);
          notifyCreditsRefresh();
        } catch (err: unknown) {
          if (projectIdRef.current !== startedForProject) return;
          if (controller.signal.aborted) {
            setUiNote("已取消剧集生成。");
            setPreviewOpen(false);
            setPreviewKind(null);
            setPreviewResult(null);
            setEpisodesParsed(null);
            return;
          }
          const msg =
            err instanceof StoryGenerationClientError
              ? err.message
              : err instanceof Error
                ? err.message
                : "剧集生成失败";
          setUiNote(msg);
          setPreviewOpen(false);
          setPreviewKind(null);
          setPreviewResult(null);
          setEpisodesParsed(null);
          notifyCreditsRefresh();
        } finally {
          if (projectIdRef.current === startedForProject) {
            generatingLockRef.current = false;
            setGenerating(false);
            activeIdempotencyRef.current = null;
            abortRef.current = null;
          }
        }
      })();
      return;
    }

    setUiNote("请先选择「讨论大纲」或「直生剧集」。");
  }, [
    brief,
    episodeLength,
    episodeNumber,
    modelId,
    outlineText,
    outputType,
    projectId,
    scriptMode,
    targetChars,
  ]);

  const handleDiscardPreview = useCallback(() => {
    const wasOutline = previewKind === "outline";
    const wasEpisodes = previewKind === "episodes";
    setPreviewOpen(false);
    setPreviewKind(null);
    setPreviewResult(null);
    setPreviewStreamText("");
    setEpisodesParsed(null);
    setEpisodesParseError("");
    setApplyError("");
    episodesGenContextRef.current = null;
    setUiNote(
      wasEpisodes
        ? "已放弃本次剧集结果，正式剧本未修改。"
        : wasOutline
          ? "已放弃本次大纲结果，大纲与正式剧本未修改。"
          : "已放弃本次生成结果，草稿未修改。",
    );
  }, [previewKind]);

  const handleApplyPreview = useCallback(() => {
    if (applyLockRef.current) return;
    const pending = previewResult?.text ?? previewStreamText;
    if (!pending.trim() && previewKind !== "episodes") return;
    if (projectIdRef.current !== projectId) {
      setApplyError("项目已切换，无法应用该结果。");
      return;
    }

    if (previewKind === "episodes") {
      if (!episodesParsed) {
        setApplyError("结构化结果无效，无法应用。请重新生成。");
        return;
      }
      if (hasFormalEpisodes) {
        const ok = window.confirm(
          `应用后将替换第 ${episodeNumber} 集，并使该集相关分镜进入过期状态。历史分镜和历史视频不会被删除。`,
        );
        if (!ok) return;
      }
      applyLockRef.current = true;
      setApplyingPreview(true);
      setApplyError("");
      const applyProjectId = projectId;
      const ctx = episodesGenContextRef.current;
      void (async () => {
        try {
          const putRes = await fetch(
            `/api/projects/${encodeURIComponent(applyProjectId)}/script-draft`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({
                applyGeneratedEpisodes: episodesParsed,
                expectedUpdatedAt: ctx?.draftUpdatedAt,
                expectedOutlineFingerprint: ctx?.outlineFingerprint,
              }),
            },
          );
          const putPayload = (await putRes.json()) as {
            error?: string;
            code?: string;
            invalidated?: boolean;
            draft?: { episodes?: unknown[]; outlineText?: string | null };
          };
          if (projectIdRef.current !== applyProjectId) return;
          if (putRes.status === 409) {
            if (putPayload.code === "OUTLINE_FINGERPRINT_MISMATCH") {
              throw new Error(
                "大纲已发生变化，请基于最新大纲重新生成剧集。",
              );
            }
            throw new Error("草稿冲突：请刷新后重新生成并应用剧集。");
          }
          if (!putRes.ok) {
            throw new Error(putPayload.error ?? "保存剧集失败");
          }
          setHasFormalEpisodes(
            Array.isArray(putPayload.draft?.episodes) &&
              (putPayload.draft?.episodes.length ?? 0) > 0,
          );
          setPreviewOpen(false);
          setPreviewKind(null);
          setPreviewResult(null);
          setPreviewStreamText("");
          setEpisodesParsed(null);
          setEpisodesParseError("");
          episodesGenContextRef.current = null;
          setUiNote(
            putPayload.invalidated
              ? "已应用到正式剧本；相关分镜已进入过期状态。历史分镜与视频已保留。"
              : "已应用到正式剧本（内容未变化，未重复使分镜失效）。",
          );
        } catch (err) {
          if (projectIdRef.current !== applyProjectId) return;
          setApplyError(err instanceof Error ? err.message : "保存失败");
          setUiNote(err instanceof Error ? err.message : "保存失败");
        } finally {
          applyLockRef.current = false;
          setApplyingPreview(false);
        }
      })();
      return;
    }

    if (previewKind === "outline") {
      if (outlineText.trim()) {
        const ok = window.confirm(
          "应用后将替换当前大纲，但不会修改已导入剧本和分镜。",
        );
        if (!ok) return;
      }
      applyLockRef.current = true;
      setApplyingPreview(true);
      setApplyError("");
      const applyProjectId = projectId;
      void (async () => {
        try {
          const getRes = await fetch(
            `/api/projects/${encodeURIComponent(applyProjectId)}/script-draft`,
            { credentials: "include" },
          );
          if (!getRes.ok) {
            throw new Error("无法读取剧本草稿");
          }
          const getPayload = (await getRes.json()) as {
            draft?: Record<string, unknown> | null;
          };
          const current = getPayload.draft ?? {
            projectId: applyProjectId,
            episodes: [],
            sourceText: null,
            preambleNotes: null,
            sourceImport: null,
            sourceFile: null,
            novelTask: {
              id: `novel-task-${applyProjectId}`,
              projectId: applyProjectId,
              sourceFile: null,
              status: "uploaded",
              resultScriptId: null,
              createdAt: new Date().toISOString(),
            },
            selectedId: null,
            listPage: 1,
            splitConfig: {
              mode: "by-episode-count",
              totalEpisodes: 36,
              charsPerEpisode: 1500,
            },
            novelOpen: false,
          };
          const putRes = await fetch(
            `/api/projects/${encodeURIComponent(applyProjectId)}/script-draft`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({
                ...current,
                outlineText: pending,
              }),
            },
          );
          const putPayload = (await putRes.json()) as {
            error?: string;
            invalidated?: boolean;
          };
          if (projectIdRef.current !== applyProjectId) return;
          if (putRes.status === 409) {
            throw new Error("草稿冲突：请刷新后重新应用大纲。");
          }
          if (!putRes.ok) {
            throw new Error(putPayload.error ?? "保存大纲失败");
          }
          setOutlineText(pending);
          setPreviewOpen(false);
          setPreviewKind(null);
          setPreviewResult(null);
          setPreviewStreamText("");
          setUiNote(
            putPayload.invalidated
              ? "已写入大纲，但服务端报告内容指纹变化（请检查正式剧本是否被意外改动）。"
              : "已应用到剧本大纲。刷新后仍可读取；正式剧本与分镜未改动。",
          );
        } catch (err) {
          if (projectIdRef.current !== applyProjectId) return;
          setApplyError(err instanceof Error ? err.message : "保存失败");
          setUiNote(err instanceof Error ? err.message : "保存失败");
        } finally {
          applyLockRef.current = false;
          setApplyingPreview(false);
        }
      })();
      return;
    }

    if (resultText.trim()) {
      const ok = window.confirm(
        "应用后将替换当前故事草稿，尚未保存的内容可能丢失。",
      );
      if (!ok) return;
    }

    applyLockRef.current = true;
    setApplyingPreview(true);
    setApplyError("");
    const chars = clampTargetChars(targetChars);
    const applyProjectId = projectId;

    void (async () => {
      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(applyProjectId)}/story-draft`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              brief,
              outputKind: "story",
              modelKey: modelId,
              targetChars: chars,
              resultText: pending,
              scriptMode,
              episodeNumber,
              episodeLength,
            }),
          },
        );
        const payload = (await res.json()) as { error?: string };
        if (projectIdRef.current !== applyProjectId) return;
        if (!res.ok) {
          throw new Error(payload.error ?? "保存失败");
        }
        setResultText(pending);
        const snap = toSnapshot({
          brief,
          outputType: "story",
          modelId,
          targetChars: chars,
          resultText: pending,
          scriptMode,
          episodeNumber,
          episodeLength,
        });
        setSavedSnapshot(snap);
        setSaveState("saved");
        setPreviewOpen(false);
        setPreviewKind(null);
        setPreviewResult(null);
        setPreviewStreamText("");
        setUiNote("已应用到故事草稿。刷新后仍可读取。");
      } catch (err) {
        if (projectIdRef.current !== applyProjectId) return;
        setApplyError(err instanceof Error ? err.message : "保存失败");
        setUiNote(err instanceof Error ? err.message : "保存失败");
      } finally {
        applyLockRef.current = false;
        setApplyingPreview(false);
      }
    })();
  }, [
    brief,
    episodeLength,
    episodeNumber,
    episodesParsed,
    hasFormalEpisodes,
    modelId,
    outlineText,
    previewKind,
    previewResult,
    previewStreamText,
    projectId,
    resultText,
    scriptMode,
    targetChars,
  ]);

  const handleCancelGenerating = useCallback(() => {
    const gid = activeGenerationIdRef.current;
    abortRef.current?.abort();
    if (gid) {
      void cancelStoryGeneration(projectId, gid);
    }
  }, [projectId]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleContinueGenerate = useCallback(() => {
    setUiNote("该功能尚在开发中。");
  }, []);

  const handleSwitchToScript = useCallback(() => {
    const next = switchToScriptMode();
    setOutputType(next);
    const sourceContent = resultText.trim() || brief;
    setUiNote(
      "已切换到剧本模式；调用共用 convertNovelToScript() 预留（本阶段不请求模型）。",
    );
    if (sourceContent) {
      void convertNovelToScript({
        projectId,
        sourceFile: {
          id: `story-bridge-${Date.now()}`,
          name: "story-source.txt",
          type: "txt",
          size: sourceContent.length,
          status: "selected",
        },
      }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "转换未接入";
        setUiNote(msg);
      });
    }
  }, [brief, projectId, resultText]);

  const handleExport = useCallback(() => {
    setUiNote("已预留 exportDocuments()，本阶段不生成 Word。");
    void exportDocuments({
      projectId,
      documentIds: selectedExportIds,
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : "导出未接入";
      setUiNote(msg);
    });
  }, [projectId, selectedExportIds]);

  const toggleExportId = useCallback((id: string) => {
    setSelectedExportIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);

  const saveLabel =
    saveState === "saving"
      ? "保存中…"
      : saveState === "saved" && !dirty
        ? "已保存"
        : "保存页面";

  return (
    <div className="scw">
      <div className="scw-inner">
        <header className="scw-head">
          <div className="scw-head__row">
            <div className="scw-head__titles">
              <h1>故事创作工作台</h1>
              <p>
                {loadError
                  ? loadError
                  : projectName
                    ? `项目：${projectName}`
                    : `项目 ID：${projectId}`}
                {dirty ? (
                  <span className="scw-head__dirty"> · 未保存</span>
                ) : null}
              </p>
            </div>
            <button
              type="button"
              className={`scw-btn scw-btn-primary scw-head__save ${saveBounce.bounceClass}`}
              disabled={saveState === "saving" || !dirty}
              onClick={() => {
                saveBounce.trigger();
                void handleSave();
              }}
              onAnimationEnd={saveBounce.onAnimationEnd}
            >
              {saveLabel}
            </button>
          </div>
        </header>

        <div className="scw-grid">
          <StoryInputPanel
            brief={brief}
            outputType={outputType}
            modelId={modelId}
            targetChars={targetChars}
            scriptMode={scriptMode}
            episodeNumber={episodeNumber}
            episodeLength={episodeLength}
            showContinueGenerate={
              outputType === "script" && showContinueGenerate
            }
            generating={generating}
            uiNote={uiNote}
            onBriefChange={setBrief}
            onOutputTypeChange={(type) => {
              setOutputType(type);
              if (type === "story") {
                setShowContinueGenerate(false);
                setScriptMode(null);
              }
              setUiNote("");
              setSaveState("idle");
            }}
            onModelChange={setModelId}
            onTargetCharsChange={(n) => setTargetChars(clampTargetChars(n))}
            onScriptModeChange={setScriptMode}
            onEpisodeNumberChange={setEpisodeNumber}
            onEpisodeLengthChange={setEpisodeLength}
            onGenerate={handleGenerate}
            onCancelGenerate={handleCancelGenerating}
            onContinueGenerate={handleContinueGenerate}
            onDiscussOutline={() =>
              setUiNote("已选择「讨论大纲」。填写创作材料后点击「生成」。")
            }
            onDirectEpisode={() =>
              setUiNote("直生剧集：将根据已保存大纲生成当前选中集。")
            }
          />

          <GenerationResultPanel
            resultText={
              scriptMode === "discuss-outline" ? outlineText : resultText
            }
            onResultChange={(value) => {
              if (scriptMode === "discuss-outline") {
                setOutlineText(value);
              } else {
                setResultText(value);
              }
              setSaveState("idle");
            }}
            onOpenHistory={() => setHistoryOpen(true)}
            onOpenExport={() => {
              setSelectedExportIds(historyItems.map((h) => h.id));
              setExportOpen(true);
            }}
            onSwitchToScript={handleSwitchToScript}
          />
        </div>
      </div>

      <GenerationHistoryPanel
        open={historyOpen}
        items={historyItems}
        onClose={() => setHistoryOpen(false)}
        onSelect={(item) => {
          setResultText(item.content);
          setHistoryOpen(false);
          setSaveState("idle");
          setUiNote(`已载入历史：版本${item.version}（${item.label}）`);
        }}
      />

      <ExportDialog
        open={exportOpen}
        items={historyItems}
        selectedIds={selectedExportIds}
        onClose={() => setExportOpen(false)}
        onToggle={toggleExportId}
        onExport={handleExport}
      />

      <StoryGenerationPreview
        open={previewOpen && previewKind === "story"}
        text={previewResult?.text ?? previewStreamText}
        statusLabel={
          generating
            ? "生成中"
            : previewResult
              ? "已完成"
              : "预览"
        }
        displayModelName={previewResult?.displayModelName}
        chargedPoints={previewResult?.chargedPoints}
        actualChars={previewResult?.actualChars}
        applying={applyingPreview}
        errorNote={applyError || undefined}
        onApply={handleApplyPreview}
        onDiscard={handleDiscardPreview}
      />

      <ScriptOutlineGenerationPreview
        open={previewOpen && previewKind === "outline"}
        text={previewResult?.text ?? previewStreamText}
        statusLabel={
          generating
            ? "生成中"
            : previewResult
              ? "已完成"
              : "预览"
        }
        displayModelName={previewResult?.displayModelName}
        chargedPoints={previewResult?.chargedPoints}
        actualChars={previewResult?.actualChars}
        applying={applyingPreview}
        hasExistingOutline={Boolean(outlineText.trim())}
        errorNote={applyError || undefined}
        onApply={handleApplyPreview}
        onDiscard={handleDiscardPreview}
      />

      <ScriptEpisodesGenerationPreview
        open={previewOpen && previewKind === "episodes"}
        rawText={previewResult?.text ?? previewStreamText}
        parsed={episodesParsed}
        parseError={episodesParseError}
        statusLabel={
          generating
            ? "生成中"
            : episodesParseError
              ? "解析失败"
              : previewResult
                ? "已完成"
                : "预览"
        }
        displayModelName={previewResult?.displayModelName}
        chargedPoints={previewResult?.chargedPoints}
        applying={applyingPreview}
        hasExistingEpisodes={hasFormalEpisodes}
        targetEpisodeNumber={previewTargetEpisodeNumber}
        errorNote={applyError || undefined}
        onApply={handleApplyPreview}
        onDiscard={handleDiscardPreview}
      />

      <ConfirmLeaveDialog
        open={leaveOpen}
        title="离开故事创作工作台？"
        description="当前有未保存的编辑内容，离开后可能丢失。"
        onConfirm={() => {
          setLeaveOpen(false);
          leaveResolveRef.current?.(true);
          leaveResolveRef.current = null;
        }}
        onCancel={() => {
          setLeaveOpen(false);
          leaveResolveRef.current?.(false);
          leaveResolveRef.current = null;
        }}
      />
    </div>
  );
}
