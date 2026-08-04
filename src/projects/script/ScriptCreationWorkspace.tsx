"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  convertNovelToScript,
  exportScriptToWord,
  splitScriptEpisodes,
} from "@/projects/script/api-stubs";
import { EpisodeManager } from "@/projects/script/EpisodeManager";
import { buildScriptFolderStructure } from "@/projects/script/mock-data";
import { NovelToScriptPanel } from "@/projects/script/NovelToScriptPanel";
import { ScriptDocumentEditor } from "@/projects/script/ScriptDocumentEditor";
import { ScriptProcessPanel } from "@/projects/script/ScriptProcessPanel";
import { ScriptTxtImportPreview } from "@/projects/script/ScriptTxtImportPreview";
import { ScriptUploadPanel } from "@/projects/script/ScriptUploadPanel";
import {
  buildSourceImportFromPreview,
  postScriptImportByFile,
  scriptSourceFileTypeFromFormat,
  type ScriptImportApiResponse,
} from "@/projects/script/script-txt-client";
import type { ScriptDraft } from "@/projects/script/script-draft-store";
import {
  createScriptSplitConfirmIdempotencyKey,
  episodeContentFingerprintClient,
} from "@/projects/script/script-split-client";
import {
  emptyEpisodeSplitState,
  type ProposedEpisode,
  type ScriptEpisodeSplitState,
} from "@/projects/script/script-split-types";
import type {
  EpisodeSplitConfig,
  NovelConversionTask,
  ScriptEpisode,
  ScriptSourceFile,
  ScriptSourceImport,
} from "@/projects/script/types";
import { EPISODE_CHARS_DEFAULT } from "@/projects/script/types";
import { countVisibleChars } from "@/text-generation/char-count";
import { useChipBounce } from "@/shell/useChipBounce";
import "@/projects/script/script-workspace.css";

type Props = {
  projectId: string;
};

function emptyNovelTask(projectId: string): NovelConversionTask {
  return {
    id: `novel-task-${projectId}`,
    projectId,
    sourceFile: null,
    status: "uploaded",
    resultScriptId: null,
    createdAt: new Date().toISOString(),
  };
}

function applyDraftToState(
  draft: ScriptDraft,
  setters: {
    setSourceFile: (v: ScriptSourceFile | null) => void;
    setSourceText: (v: string | null) => void;
    setPreambleNotes: (v: string | null) => void;
    setSourceImport: (v: ScriptSourceImport | null) => void;
    setNovelTask: (v: NovelConversionTask) => void;
    setEpisodes: (v: ScriptEpisode[]) => void;
    setSelectedId: (v: string | null) => void;
    setListPage: (v: number) => void;
    setSplitConfig: (v: EpisodeSplitConfig) => void;
    setNovelOpen: (v: boolean) => void;
    setEpisodeSplit: (v: ScriptEpisodeSplitState) => void;
  },
) {
  setters.setSourceFile(draft.sourceFile);
  setters.setSourceText(draft.sourceText);
  setters.setPreambleNotes(draft.preambleNotes);
  setters.setSourceImport(draft.sourceImport);
  setters.setNovelTask(draft.novelTask);
  setters.setEpisodes(draft.episodes);
  setters.setSelectedId(draft.selectedId);
  setters.setListPage(draft.listPage);
  setters.setSplitConfig(draft.splitConfig);
  setters.setNovelOpen(draft.novelOpen);
  setters.setEpisodeSplit(draft.episodeSplit ?? emptyEpisodeSplitState());
}

export function ScriptCreationWorkspace({ projectId }: Props) {
  const router = useRouter();
  const nextBounce = useChipBounce();
  const saveBounce = useChipBounce();
  const splitBounce = useChipBounce();

  const [projectName, setProjectName] = useState("");
  const [rootFolderId, setRootFolderId] = useState(projectId);
  const [projectMode, setProjectMode] = useState<"canvas" | "full-stack">(
    "full-stack",
  );
  const [loadError, setLoadError] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [sourceFile, setSourceFile] = useState<ScriptSourceFile | null>(null);
  const [sourceText, setSourceText] = useState<string | null>(null);
  const [preambleNotes, setPreambleNotes] = useState<string | null>(null);
  const [sourceImport, setSourceImport] = useState<ScriptSourceImport | null>(
    null,
  );
  const [novelOpen, setNovelOpen] = useState(false);
  const [novelTask, setNovelTask] = useState<NovelConversionTask>(() =>
    emptyNovelTask(projectId),
  );
  const [episodes, setEpisodes] = useState<ScriptEpisode[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listPage, setListPage] = useState(1);
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitConfig, setSplitConfig] = useState<EpisodeSplitConfig>({
    mode: "by-episode-count",
    totalEpisodes: 36,
    charsPerEpisode: EPISODE_CHARS_DEFAULT,
  });
  const [episodeSplit, setEpisodeSplit] = useState<ScriptEpisodeSplitState>(
    () => emptyEpisodeSplitState(),
  );
  const [proposedEpisodes, setProposedEpisodes] = useState<ProposedEpisode[]>(
    [],
  );
  const [splitGenerating, setSplitGenerating] = useState(false);
  const [splitStage, setSplitStage] = useState("");
  const [confirmingSplit, setConfirmingSplit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [confirmingImport, setConfirmingImport] = useState(false);
  const [importPreview, setImportPreview] =
    useState<ScriptImportApiResponse | null>(null);
  const [uiNote, setUiNote] = useState("");
  const importSeqRef = useRef(0);
  const splitGenerationIdRef = useRef<string | null>(null);

  const selectedEpisode =
    episodes.find((ep) => ep.id === selectedId) ?? null;

  const folderStructure = useMemo(
    () =>
      buildScriptFolderStructure({
        projectId,
        rootFolderId,
        projectName: projectName || "未命名项目",
      }),
    [projectId, projectName, rootFolderId],
  );

  const draftSetters = useMemo(
    () => ({
      setSourceFile,
      setSourceText,
      setPreambleNotes,
      setSourceImport,
      setNovelTask,
      setEpisodes,
      setSelectedId,
      setListPage,
      setSplitConfig,
      setNovelOpen,
      setEpisodeSplit,
    }),
    [],
  );

  useEffect(() => {
    const next =
      episodeSplit.status === "review" ||
      (episodeSplit.status === "confirmed" &&
        episodeSplit.proposedEpisodes.length > 0)
        ? episodeSplit.proposedEpisodes
        : episodeSplit.status === "not_started" ||
            episodeSplit.status === "generating"
          ? []
          : null;
    if (next === null) return;
    const id = window.setTimeout(() => {
      setProposedEpisodes(next);
      if (episodeSplit.status === "review" && next.length > 0) {
        setSelectedId((curr) =>
          next.some((ep) => ep.id === curr) ? curr : next[0]!.id,
        );
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, [episodeSplit]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/script-draft`,
        );
        if (!res.ok) {
          if (!cancelled) {
            setLoadError("无法加载剧本草稿");
            const meta = await fetch(
              `/api/projects/${encodeURIComponent(projectId)}`,
            );
            if (meta.ok) {
              const data = (await meta.json()) as {
                project?: {
                  name?: string;
                  rootFolderId?: string;
                  projectMode?: "canvas" | "full-stack";
                };
              };
              setProjectName(data.project?.name ?? "");
              setRootFolderId(data.project?.rootFolderId ?? projectId);
              setProjectMode(data.project?.projectMode ?? "full-stack");
            }
          }
          return;
        }
        const data = (await res.json()) as {
          project?: {
            name?: string;
            rootFolderId?: string;
            projectMode?: "canvas" | "full-stack";
          };
          draft?: ScriptDraft | null;
        };
        if (cancelled) return;
        setProjectName(data.project?.name ?? "");
        setRootFolderId(data.project?.rootFolderId ?? projectId);
        setProjectMode(data.project?.projectMode ?? "full-stack");
        if (data.draft) {
          applyDraftToState(data.draft, draftSetters);
        }
        setLoadError("");
      } catch {
        if (!cancelled) setLoadError("无法加载剧本草稿");
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [draftSetters, projectId]);

  const handleScriptFile = useCallback(
    async (file: File) => {
      const seq = ++importSeqRef.current;
      setUiNote("");
      setImporting(true);
      const lower = file.name.toLowerCase();
      const type = lower.endsWith(".docx")
        ? ("docx" as const)
        : lower.endsWith(".md") || lower.endsWith(".markdown")
          ? ("md" as const)
          : ("txt" as const);
      setSourceFile({
        id: `file-pending`,
        name: file.name.replace(/\\/g, "/").split("/").pop() || file.name,
        type,
        size: file.size,
        status: "uploading",
      });
      try {
        const preview = await postScriptImportByFile(projectId, file);
        if (seq !== importSeqRef.current) return;
        setImportPreview(preview);
        setSourceFile({
          id: `file-${preview.sha256.slice(0, 12)}`,
          name: preview.fileName,
          type,
          size: preview.byteLength,
          status: "selected",
        });
        setUiNote(
          `已解析 ${preview.episodeCount} 集预览，确认后将保存源文本并进入本地分集。`,
        );
      } catch (error) {
        if (seq !== importSeqRef.current) return;
        setImportPreview(null);
        setSourceFile((prev) =>
          prev
            ? { ...prev, status: "error" }
            : {
                id: "file-error",
                name: file.name,
                type,
                size: file.size,
                status: "error",
              },
        );
        setUiNote(error instanceof Error ? error.message : "解析失败");
      } finally {
        if (seq === importSeqRef.current) {
          setImporting(false);
        }
      }
    },
    [projectId],
  );

  const handleCancelImport = useCallback(() => {
    setImportPreview(null);
    setUiNote("已取消导入，当前草稿未修改。");
  }, []);

  const handleConfirmImport = useCallback(async () => {
    if (!importPreview) return;
    setConfirmingImport(true);
    setUiNote("");
    try {
      const sourceImportMeta = buildSourceImportFromPreview(importPreview);
      const nextSourceFile: ScriptSourceFile = {
        id: `file-${importPreview.sha256.slice(0, 12)}`,
        name: importPreview.fileName,
        type: scriptSourceFileTypeFromFormat(importPreview.format),
        size: importPreview.byteLength,
        status: "uploaded",
      };
      const resetSplit = emptyEpisodeSplitState();
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/script-draft`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            sourceFile: nextSourceFile,
            sourceText: importPreview.sourceText,
            preambleNotes: importPreview.preamble || null,
            sourceImport: sourceImportMeta,
            novelTask,
            episodes: [],
            selectedId: null,
            listPage: 1,
            splitConfig,
            novelOpen,
            episodeSplit: resetSplit,
          }),
        },
      );
      const payload = (await res.json()) as {
        error?: string;
        draft?: ScriptDraft;
      };
      if (!res.ok) {
        throw new Error(payload.error ?? "保存失败");
      }
      if (payload.draft) {
        applyDraftToState(payload.draft, draftSetters);
      } else {
        setEpisodes([]);
        setSelectedId(null);
        setEpisodeSplit(resetSplit);
        setProposedEpisodes([]);
      }
      setImportPreview(null);
      setUiNote(
        importPreview.format === "docx"
          ? "DOCX 源文本已保存。请点击「分集」进行本地分集。"
          : importPreview.format === "md"
            ? "Markdown 源文本已保存。请点击「分集」进行本地分集。"
            : "TXT 源文本已保存。请点击「分集」进行本地分集。",
      );
    } catch (error) {
      setUiNote(error instanceof Error ? error.message : "保存失败");
    } finally {
      setConfirmingImport(false);
    }
  }, [
    draftSetters,
    importPreview,
    novelOpen,
    novelTask,
    projectId,
    splitConfig,
  ]);

  const persistEpisodeSplitGenerating = useCallback(
    async (generationId: string | null) => {
      const nextSplit: ScriptEpisodeSplitState = {
        ...(episodeSplit ?? emptyEpisodeSplitState()),
        status: "generating",
        generationId,
        errorMessage: null,
      };
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/script-draft`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            sourceFile,
            sourceText,
            preambleNotes,
            sourceImport,
            novelTask,
            episodes,
            selectedId,
            listPage,
            splitConfig,
            novelOpen,
            episodeSplit: nextSplit,
          }),
        },
      );
      const payload = (await res.json()) as { draft?: ScriptDraft };
      if (payload.draft) {
        applyDraftToState(payload.draft, draftSetters);
      } else {
        setEpisodeSplit(nextSplit);
      }
    },
    [
      draftSetters,
      episodeSplit,
      episodes,
      listPage,
      novelOpen,
      novelTask,
      preambleNotes,
      projectId,
      selectedId,
      sourceFile,
      sourceImport,
      sourceText,
      splitConfig,
    ],
  );

  const handleStartSplit = useCallback(async () => {
    if (splitGenerating || !sourceText?.trim()) {
      if (!sourceText?.trim()) {
        setUiNote("请先导入并确认剧本源文本后再分集。");
      }
      return;
    }
    setSplitOpen(false);
    setSplitGenerating(true);
    setSplitStage("本地分集处理中：正在按标题/段落切分…");
    setUiNote("");
    splitGenerationIdRef.current = null;

    try {
      await persistEpisodeSplitGenerating(null);
      setSplitStage("本地分集处理中：正在生成分集方案…");
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/script-draft/local-split`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceFingerprint: episodeSplit.sourceFingerprint ?? undefined,
          }),
        },
      );
      const payload = (await res.json()) as {
        error?: string;
        draft?: ScriptDraft;
        warnings?: string[];
        mode?: string;
      };
      if (!res.ok) {
        throw new Error(payload.error ?? "本地分集失败");
      }
      if (payload.draft) {
        applyDraftToState(payload.draft, draftSetters);
      }
      const warn =
        payload.warnings && payload.warnings.length > 0
          ? `（${payload.warnings.slice(0, 2).join("；")}）`
          : "";
      setUiNote(
        `本地分集完成${payload.mode === "blocks" ? "（按段落均分）" : "（按标题）"}，请核对各集后确认剧本。${warn}`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "分集失败，请稍后重试";
      setUiNote(message);
      const failedSplit: ScriptEpisodeSplitState = {
        ...(episodeSplit ?? emptyEpisodeSplitState()),
        status: "failed",
        generationId: null,
        errorMessage: message,
      };
      setEpisodeSplit(failedSplit);
      try {
        await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/script-draft`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId,
              sourceFile,
              sourceText,
              preambleNotes,
              sourceImport,
              novelTask,
              episodes,
              selectedId,
              listPage,
              splitConfig,
              novelOpen,
              episodeSplit: failedSplit,
            }),
          },
        );
      } catch {
        /* keep local failed state */
      }
    } finally {
      setSplitGenerating(false);
      setSplitStage("");
    }
  }, [
    draftSetters,
    episodeSplit,
    episodes,
    listPage,
    novelOpen,
    novelTask,
    persistEpisodeSplitGenerating,
    preambleNotes,
    projectId,
    selectedId,
    sourceFile,
    sourceImport,
    sourceText,
    splitConfig,
    splitGenerating,
  ]);

  const handleCancelSplit = useCallback(async () => {
    setSplitGenerating(false);
    setSplitStage("");
    const resetSplit = emptyEpisodeSplitState();
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/script-draft`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            sourceFile,
            sourceText,
            preambleNotes,
            sourceImport,
            novelTask,
            episodes,
            selectedId,
            listPage,
            splitConfig,
            novelOpen,
            episodeSplit: resetSplit,
          }),
        },
      );
      const payload = (await res.json()) as { draft?: ScriptDraft };
      if (payload.draft) {
        applyDraftToState(payload.draft, draftSetters);
      } else {
        setEpisodeSplit(resetSplit);
        setProposedEpisodes([]);
      }
    } catch {
      setEpisodeSplit(resetSplit);
      setProposedEpisodes([]);
    }
    setUiNote("已取消分集。");
  }, [
    draftSetters,
    episodes,
    listPage,
    novelOpen,
    novelTask,
    preambleNotes,
    projectId,
    selectedId,
    sourceFile,
    sourceImport,
    sourceText,
    splitConfig,
  ]);

  const handleConfirmSplit = useCallback(() => {
    setSplitOpen(false);
    setUiNote("手动分集规则仅作备用，请优先使用「分集」本地分集。");
    void splitScriptEpisodes({
      projectId,
      ...splitConfig,
    }).catch(() => {
      /* stub */
    });
  }, [projectId, splitConfig]);

  const handleConfirmScript = useCallback(async () => {
    if (episodeSplit.status === "confirmed" && episodes.length > 0) {
      nextBounce.trigger();
      router.push(`/app/projects/${encodeURIComponent(projectId)}/assets`);
      return;
    }
    if (episodeSplit.status !== "review" || proposedEpisodes.length === 0) {
      return;
    }
    setConfirmingSplit(true);
    setUiNote("");
    try {
      const withFingerprints = await Promise.all(
        proposedEpisodes.map(async (ep) => ({
          ...ep,
          title: ep.title.trim(),
          contentFingerprint: await episodeContentFingerprintClient(ep.text),
        })),
      );
      const sourceFingerprint = episodeSplit.sourceFingerprint;
      if (!sourceFingerprint) {
        throw new Error("缺少源文本指纹，请重新分集");
      }
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/script-draft/confirm-split`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceFingerprint,
            confirmedRevision: episodeSplit.confirmedRevision,
            proposedEpisodes: withFingerprints,
            idempotencyKey: createScriptSplitConfirmIdempotencyKey(),
          }),
        },
      );
      const payload = (await res.json()) as {
        error?: string;
        draft?: ScriptDraft;
      };
      if (!res.ok) {
        throw new Error(payload.error ?? "确认分集失败");
      }
      if (payload.draft) {
        applyDraftToState(payload.draft, draftSetters);
      }
      setUiNote("分集已确认，正在进入资产设计…");
      nextBounce.trigger();
      router.push(`/app/projects/${encodeURIComponent(projectId)}/assets`);
    } catch (error) {
      setUiNote(error instanceof Error ? error.message : "确认分集失败");
    } finally {
      setConfirmingSplit(false);
    }
  }, [
    draftSetters,
    episodeSplit.confirmedRevision,
    episodeSplit.sourceFingerprint,
    episodeSplit.status,
    episodes.length,
    nextBounce,
    projectId,
    proposedEpisodes,
    router,
  ]);

  const updateProposedEpisode = useCallback(
    (id: string, patch: Partial<Pick<ProposedEpisode, "title" | "text">>) => {
      setProposedEpisodes((prev) => {
        const next = prev.map((ep) =>
          ep.id === id ? { ...ep, ...patch } : ep,
        );
        setEpisodeSplit((split) => ({
          ...split,
          proposedEpisodes: next,
        }));
        return next;
      });
    },
    [],
  );

  const handleNovelFileSelect = useCallback(
    async (file: File) => {
      setUiNote("正在检查小说字数…");
      try {
        const preview = await postScriptImportByFile(projectId, file);
        const sourceFile: ScriptSourceFile = {
          id: `novel-${preview.sha256.slice(0, 12)}`,
          name: preview.fileName,
          type: scriptSourceFileTypeFromFormat(preview.format),
          size: preview.byteLength,
          status: "selected",
        };
        setNovelTask((prev) => ({
          ...prev,
          sourceFile,
          status: "uploaded",
          resultScriptId: null,
        }));
        setUiNote(
          `小说文件已上传，共 ${preview.characterCount.toLocaleString("zh-CN")} 字，请点击「开始转换剧本」。`,
        );
      } catch (error) {
        setNovelTask((prev) => ({
          ...prev,
          sourceFile: null,
          status: "failed",
          resultScriptId: null,
        }));
        setUiNote(error instanceof Error ? error.message : "小说文件检查失败");
      }
    },
    [projectId],
  );

  const handleCancelNovelUpload = useCallback(() => {
    setNovelTask((prev) => ({
      ...prev,
      sourceFile: null,
      status: "uploaded",
      resultScriptId: null,
    }));
    setUiNote("已取消小说上传。");
  }, []);

  const handleStartConvert = useCallback(() => {
    if (!novelTask.sourceFile) return;
    setNovelTask((prev) => ({ ...prev, status: "processing" }));
    setUiNote("已预留 convertNovelToScript()，本阶段模拟转换完成。");
    void convertNovelToScript({
      projectId,
      sourceFile: novelTask.sourceFile,
    }).catch(() => {
      /* stub */
    });
    window.setTimeout(() => {
      setNovelTask((prev) => ({
        ...prev,
        status: "completed",
        resultScriptId: `script-stub`,
      }));
      setUiNote("转换完成（Stub）。请改用文件导入写入源文本后本地分集。");
    }, 400);
  }, [novelTask.sourceFile, projectId]);

  const handleSavePage = useCallback(async () => {
    setSaving(true);
    setUiNote("");
    try {
      const nextEpisodes = episodes.map((ep) =>
        ep.id === selectedId
          ? {
              ...ep,
              wordCount: countVisibleChars(ep.content),
              status: "saved" as const,
              updatedAt: new Date().toISOString(),
            }
          : ep,
      );
      const nextProposed =
        episodeSplit.status === "review"
          ? await Promise.all(
              proposedEpisodes.map(async (ep) => ({
                ...ep,
                title: ep.title.trim() || ep.title,
                contentFingerprint: await episodeContentFingerprintClient(
                  ep.text,
                ),
              })),
            )
          : episodeSplit.proposedEpisodes;
      const nextSplit: ScriptEpisodeSplitState = {
        ...episodeSplit,
        proposedEpisodes: nextProposed,
      };
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/script-draft`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            sourceFile,
            sourceText,
            preambleNotes,
            sourceImport,
            novelTask,
            episodes: nextEpisodes,
            selectedId,
            listPage,
            splitConfig,
            novelOpen,
            episodeSplit: nextSplit,
          }),
        },
      );
      const payload = (await res.json()) as {
        error?: string;
        draft?: ScriptDraft;
      };
      if (!res.ok) {
        throw new Error(payload.error ?? "保存失败");
      }
      if (payload.draft) {
        applyDraftToState(payload.draft, draftSetters);
      } else {
        setEpisodes(nextEpisodes);
        setEpisodeSplit(nextSplit);
        setProposedEpisodes(nextProposed);
      }
      setUiNote("页面已保存到服务器。");
    } catch (error) {
      setUiNote(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }, [
    draftSetters,
    episodeSplit,
    episodes,
    listPage,
    novelOpen,
    novelTask,
    preambleNotes,
    projectId,
    proposedEpisodes,
    selectedId,
    sourceFile,
    sourceImport,
    sourceText,
    splitConfig,
  ]);

  const modeLabel =
    projectMode === "full-stack" ? "全栈模式" : "画布模式";

  const hasFormalEpisodes = episodes.length > 0;
  const splitInReview =
    episodeSplit.status === "review" && proposedEpisodes.length > 0;
  const splitConfirmed =
    episodeSplit.status === "confirmed" && hasFormalEpisodes;
  const canGoNext = splitInReview || splitConfirmed;
  const canSplit =
    Boolean(sourceText?.trim()) &&
    !splitGenerating &&
    !importing &&
    !confirmingImport;
  const replacing = hasFormalEpisodes || Boolean(sourceText?.trim());
  const showSplitReview =
    splitInReview ||
    episodeSplit.status === "failed" ||
    episodeSplit.status === "stale";
  const fabDisabled =
    !canGoNext || splitGenerating || confirmingSplit || confirmingImport;
  const fabTitle = splitConfirmed
    ? undefined
    : splitInReview
      ? "确认分集方案并进入资产设计"
      : "请先导入源文本并完成本地分集";

  return (
    <div className="scw-script">
      <div className="scs-inner">
        <header className="scs-head">
          <div className="scs-head__titles">
            <h1>{projectName || "剧本创作工作台"}</h1>
            <p>
              {loadError
                ? loadError
                : !hydrated
                  ? "加载中…"
                  : `项目 ID：${projectId} · 根文件夹：${rootFolderId}`}
            </p>
            <p className="scs-hint" style={{ marginTop: 4 }}>
              文件夹预留：
              {folderStructure.folders.map((f) => f.name).join(" / ")}
            </p>
          </div>
          <div className="scs-head__actions">
            <span className="scs-mode-pill">当前模式：{modeLabel}</span>
            <button
              type="button"
              className={`scs-btn scs-btn-primary scs-head__save ${saveBounce.bounceClass}`}
              disabled={saving || !hydrated || importing || confirmingImport}
              onClick={() => {
                saveBounce.trigger();
                void handleSavePage();
              }}
              onAnimationEnd={saveBounce.onAnimationEnd}
            >
              {saving ? "保存中…" : "保存页面"}
            </button>
          </div>
        </header>

        <div className="scs-grid">
          <section className="scs-panel scs-panel--source" aria-label="剧本来源">
            <h2>剧本输入</h2>
            <ScriptUploadPanel
              file={sourceFile}
              canSplit={canSplit}
              importing={importing || confirmingImport || splitGenerating}
              onScriptFile={(file) => {
                void handleScriptFile(file);
              }}
              onClientError={(message) => {
                importSeqRef.current += 1;
                setImportPreview(null);
                setUiNote(message);
              }}
              onOpenSplit={() => {
                splitBounce.trigger();
                void handleStartSplit();
              }}
            />
            {splitGenerating ? (
              <div className="scs-split-status" role="status">
                <p className="scs-split-status__stage">{splitStage}</p>
                <button
                  type="button"
                  className="scs-btn"
                  data-testid="script-split-cancel"
                  onClick={() => {
                    void handleCancelSplit();
                  }}
                >
                  取消分集
                </button>
              </div>
            ) : null}
            {!splitGenerating &&
            (episodeSplit.status === "review" ||
              episodeSplit.status === "failed" ||
              episodeSplit.status === "stale") ? (
              <div className="scs-split-actions">
                <button
                  type="button"
                  className={`scs-btn scs-btn-primary ${splitBounce.bounceClass}`}
                  disabled={!canSplit}
                  onClick={() => {
                    splitBounce.trigger();
                    void handleStartSplit();
                  }}
                  onAnimationEnd={splitBounce.onAnimationEnd}
                >
                  重新分集
                </button>
              </div>
            ) : null}
            {!splitGenerating && sourceText?.trim() && !showSplitReview ? (
              <div className="scs-split-actions">
                <button
                  type="button"
                  className={`scs-btn scs-btn-primary ${splitBounce.bounceClass}`}
                  disabled={!canSplit}
                  data-testid="script-split-start"
                  onClick={() => {
                    splitBounce.trigger();
                    void handleStartSplit();
                  }}
                  onAnimationEnd={splitBounce.onAnimationEnd}
                >
                  分集
                </button>
              </div>
            ) : null}
            <NovelToScriptPanel
              open={novelOpen}
              task={novelTask}
              onToggle={() => setNovelOpen((v) => !v)}
              onNovelFileSelect={handleNovelFileSelect}
              onCancelNovelUpload={handleCancelNovelUpload}
              onStartConvert={handleStartConvert}
              onExportScript={() => {
                setUiNote("已预留 exportScriptToWord()，本阶段不生成文件。");
                void exportScriptToWord({ projectId }).catch(() => undefined);
              }}
              onSplitScript={() => setSplitOpen(true)}
              onEnterReading={() => {
                setUiNote(
                  !sourceText?.trim()
                    ? "请先导入剧本源文本。"
                    : splitInReview
                      ? "请在中间选择集数，右侧核对正文。"
                      : hasFormalEpisodes
                        ? "已进入剧本读取处理，请在中间选择集数。"
                        : "请先完成本地分集。",
                );
              }}
            />
            {uiNote ? <p className="scs-ui-note">{uiNote}</p> : null}
            {episodeSplit.status === "failed" && episodeSplit.errorMessage ? (
              <p className="scs-error" role="alert">
                {episodeSplit.errorMessage}
              </p>
            ) : null}
          </section>

          {showSplitReview ? (
            <ScriptProcessPanel
              numbersOnly
              episodes={proposedEpisodes.map((ep) => ({
                id: ep.id,
                episodeNumber: ep.episodeNumber,
                title: ep.title,
              }))}
              selectedId={selectedId}
              page={listPage}
              emptyHint="分集方案为空，请重新分集。"
              onSelect={(id) => {
                setSelectedId(id);
              }}
              onPageChange={setListPage}
            />
          ) : (
            <ScriptProcessPanel
              episodes={episodes.map((ep) => ({
                id: ep.id,
                episodeNumber: ep.episodeNumber,
                title: ep.title,
                wordCount: ep.wordCount,
                statusLabel:
                  ep.status === "saved"
                    ? "已保存"
                    : ep.status === "editing"
                      ? "编辑中"
                      : "就绪",
              }))}
              selectedId={selectedId}
              page={listPage}
              onSelect={(id) => {
                setSelectedId(id);
                setEpisodes((prev) =>
                  prev.map((ep) =>
                    ep.id === id
                      ? {
                          ...ep,
                          status: ep.status === "saved" ? "saved" : "editing",
                        }
                      : ep,
                  ),
                );
              }}
              onPageChange={setListPage}
            />
          )}

          <ScriptDocumentEditor
            reviewMode={showSplitReview}
            disabled={splitGenerating || confirmingSplit}
            episode={
              showSplitReview
                ? (() => {
                    const ep =
                      proposedEpisodes.find((p) => p.id === selectedId) ?? null;
                    return ep
                      ? { id: ep.id, title: ep.title, content: ep.text }
                      : null;
                  })()
                : selectedEpisode
                  ? {
                      id: selectedEpisode.id,
                      title: selectedEpisode.title,
                      content: selectedEpisode.content,
                    }
                  : null
            }
            hasSourceText={Boolean(sourceText?.trim())}
            splitStatus={episodeSplit.status}
            onContentChange={(content) => {
              if (showSplitReview) {
                if (!selectedId) return;
                updateProposedEpisode(selectedId, { text: content });
                return;
              }
              if (!selectedId) return;
              setEpisodes((prev) =>
                prev.map((ep) =>
                  ep.id === selectedId
                    ? {
                        ...ep,
                        content,
                        wordCount: countVisibleChars(content),
                        status: "editing",
                        updatedAt: new Date().toISOString(),
                      }
                    : ep,
                ),
              );
            }}
          />
        </div>
      </div>

      <div className="scs-next-wrap">
        {!canGoNext ? (
          <p className="scs-next-hint" role="status">
            <span className="scs-req-star" aria-hidden>
              *
            </span>
            先导入源文本、本地分集并确认方案
          </p>
        ) : null}
        <button
          type="button"
          className={`scs-next-fab ${nextBounce.bounceClass}${
            fabDisabled ? " is-disabled" : ""
          }`}
          disabled={fabDisabled}
          title={fabTitle}
          data-testid="script-confirm-fab"
          onClick={() => {
            if (fabDisabled) return;
            void handleConfirmScript();
          }}
          onAnimationEnd={nextBounce.onAnimationEnd}
        >
          {confirmingSplit ? "确认中…" : "确认剧本"}
        </button>
      </div>

      <EpisodeManager
        open={splitOpen}
        config={splitConfig}
        onClose={() => setSplitOpen(false)}
        onChange={setSplitConfig}
        onConfirm={handleConfirmSplit}
      />

      {importPreview ? (
        <ScriptTxtImportPreview
          preview={importPreview}
          replacing={replacing}
          busy={confirmingImport}
          onCancel={handleCancelImport}
          onConfirm={() => {
            void handleConfirmImport();
          }}
        />
      ) : null}
    </div>
  );
}
