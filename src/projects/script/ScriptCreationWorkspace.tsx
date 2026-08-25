"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  convertNovelToScript,
  exportScriptToWord,
  splitScriptEpisodes,
} from "@/projects/script/api-stubs";
import { EpisodeManager } from "@/projects/script/EpisodeManager";
import { ScriptConfirmExtractDialog } from "@/projects/script/ScriptConfirmExtractDialog";
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
  scriptSplitConfirmIdempotencyKey,
} from "@/projects/script/script-split-client";
import {
  formatScriptAutoSplitNote,
  scriptShowsFormalEpisodeList,
} from "@/projects/script/script-auto-split-ui";
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
import { useGenerationBusy } from "@/shell/GenerationBusyGuard";
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
  const splitBounce = useChipBounce();

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
  useGenerationBusy(
    episodeSplit.status === "generating",
    `script-split-${projectId}`,
    "剧本分集生成",
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
  const [extractPromptOpen, setExtractPromptOpen] = useState(false);
  const [extractPromptFingerprint, setExtractPromptFingerprint] = useState<
    string | null
  >(null);
  const importSeqRef = useRef(0);
  const splitRequestSeqRef = useRef(0);
  const splitGenerationIdRef = useRef<string | null>(null);
  const splitInFlightRef = useRef(false);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const editorTextareaRef = useRef<HTMLTextAreaElement | null>(null);

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

  const goToAssets = useCallback(() => {
    nextBounce.trigger();
    router.push(
      `/app/projects/${encodeURIComponent(projectId)}/assets/library`,
    );
  }, [nextBounce, projectId, router]);

  const openExtractPromptAfterConfirm = useCallback(
    (sourceFingerprint: string | null | undefined, idempotent?: boolean) => {
      if (idempotent || !sourceFingerprint?.trim()) return;
      setExtractPromptFingerprint(sourceFingerprint.trim());
      setExtractPromptOpen(true);
    },
    [],
  );

  const handleConfirmScript = useCallback(async () => {
    if (episodeSplit.status === "confirmed" && episodes.length > 0) {
      openExtractPromptAfterConfirm(episodeSplit.sourceFingerprint);
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
            idempotencyKey: sourceFingerprint
              ? scriptSplitConfirmIdempotencyKey(sourceFingerprint)
              : createScriptSplitConfirmIdempotencyKey(),
          }),
        },
      );
      const payload = (await res.json()) as {
        error?: string;
        draft?: ScriptDraft;
        idempotent?: boolean;
      };
      if (!res.ok) {
        throw new Error(payload.error ?? "确认分集失败");
      }
      if (payload.draft) {
        applyDraftToState(payload.draft, draftSetters);
      }
      console.info("[storyboard] confirm-script", { projectId });
      openExtractPromptAfterConfirm(sourceFingerprint, payload.idempotent);
      setUiNote("");
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
    openExtractPromptAfterConfirm,
    projectId,
    proposedEpisodes,
  ]);

  const selectedEpisode =
    episodes.find((ep) => ep.id === selectedId) ?? null;

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
          }
          return;
        }
        const data = (await res.json()) as {
          draft?: ScriptDraft | null;
        };
        if (cancelled) return;
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

  const persistImportedScriptAndAutoSplit = useCallback(
    async (preview: ScriptImportApiResponse): Promise<void> => {
      const sourceImportMeta = buildSourceImportFromPreview(preview);
      const nextSourceFile: ScriptSourceFile = {
        id: `file-${preview.sha256.slice(0, 12)}`,
        name: preview.fileName,
        type: scriptSourceFileTypeFromFormat(preview.format),
        size: preview.byteLength,
        status: "uploaded",
      };
      setConfirmingImport(true);
      setSplitStage("剧本已导入，正在自动分集…");
      const replaceExisting =
        episodes.length > 0 ||
        Boolean(sourceText?.trim()) ||
        Boolean(sourceImport);
      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/script-draft`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId,
              autoSplit: true,
              replaceExisting,
              sourceFile: nextSourceFile,
              sourceText: preview.sourceText,
              preambleNotes: preview.preamble || null,
              sourceImport: sourceImportMeta,
              novelTask,
              episodes,
              selectedId,
              listPage,
              splitConfig,
              novelOpen,
              episodeSplit,
            }),
          },
        );
        const payload = (await res.json()) as {
          error?: string;
          code?: string;
          draft?: ScriptDraft;
          idempotent?: boolean;
          mode?: string;
          warnings?: string[];
          downstreamSync?: { syncStatus?: string };
        };
        if (payload.draft) {
          applyDraftToState(payload.draft, draftSetters);
        }
        if (!res.ok) {
          throw new Error(payload.error ?? "自动分集失败");
        }
        const formalCount = payload.draft?.episodes.length ?? 0;
        openExtractPromptAfterConfirm(
          payload.draft?.episodeSplit?.sourceFingerprint,
          payload.idempotent,
        );
        setUiNote(
          formatScriptAutoSplitNote({
            episodeCount: formalCount,
            mode: payload.mode,
            warnings: payload.warnings,
            idempotent: payload.idempotent,
            downstreamSync: payload.downstreamSync?.syncStatus ?? null,
          }),
        );
        setImportPreview(null);
      } finally {
        setConfirmingImport(false);
        setSplitStage("");
      }
    },
    [
      draftSetters,
      episodeSplit,
      episodes,
      listPage,
      novelOpen,
      novelTask,
      openExtractPromptAfterConfirm,
      projectId,
      selectedId,
      splitConfig,
      sourceImport,
      sourceText,
    ],
  );

  const handleRemoveUploadedScript = useCallback(async () => {
    if (importing || confirmingImport || splitGenerating) return;
    const hasContent =
      Boolean(sourceFile) ||
      Boolean(sourceText?.trim()) ||
      episodes.length > 0;
    if (!hasContent) return;
    if (episodes.length > 0) {
      const confirmed = window.confirm(
        "移除剧本将清空已分集内容，是否继续？",
      );
      if (!confirmed) return;
    }
    importSeqRef.current += 1;
    splitRequestSeqRef.current += 1;
    splitInFlightRef.current = false;
    setSplitGenerating(false);
    setSplitStage("");
    setImportPreview(null);
    setUiNote("");
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/script-draft`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, clearScript: true }),
        },
      );
      const payload = (await res.json()) as {
        draft?: ScriptDraft;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(payload.error ?? "无法移除剧本");
      }
      if (payload.draft) {
        applyDraftToState(payload.draft, draftSetters);
      } else {
        setSourceFile(null);
        setSourceText("");
        setSourceImport(null);
        setPreambleNotes("");
        setEpisodes([]);
        setSelectedId(null);
        setProposedEpisodes([]);
        setEpisodeSplit(emptyEpisodeSplitState());
      }
      setUiNote("已移除上传的剧本，可重新上传。");
    } catch (error) {
      setUiNote(error instanceof Error ? error.message : "无法移除剧本");
    }
  }, [
    confirmingImport,
    draftSetters,
    episodes.length,
    importing,
    projectId,
    sourceFile,
    sourceText,
    splitGenerating,
  ]);

  const handleScriptFile = useCallback(
    async (file: File) => {
      const seq = ++importSeqRef.current;
      splitRequestSeqRef.current += 1;
      splitInFlightRef.current = false;
      setSplitGenerating(false);
      setSplitStage("");
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
        setSourceFile({
          id: `file-${preview.sha256.slice(0, 12)}`,
          name: preview.fileName,
          type,
          size: preview.byteLength,
          status: "uploaded",
        });
        setImporting(false);
        await persistImportedScriptAndAutoSplit(preview);
        if (seq !== importSeqRef.current) return;
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
    [persistImportedScriptAndAutoSplit, projectId],
  );

  const handleCancelImport = useCallback(() => {
    setImportPreview(null);
    setUiNote("已取消导入，当前草稿未修改。");
  }, []);

  const runLocalSplit = useCallback(
    async (options?: {
      body?: Record<string, unknown>;
      stageMessage?: string;
    }): Promise<string> => {
      if (splitInFlightRef.current) {
        throw new Error("分集进行中，请稍候");
      }
      const seq = ++splitRequestSeqRef.current;
      const importSeqAtStart = importSeqRef.current;
      splitInFlightRef.current = true;
      setSplitOpen(false);
      setSplitGenerating(true);
      setSplitStage(
        options?.stageMessage ?? "正在自动生成分集方案…",
      );
      splitGenerationIdRef.current = null;

      let responseHandled = false;
      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/script-draft/local-split`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(options?.body ?? {}),
          },
        );
        const payload = (await res.json()) as {
          error?: string;
          draft?: ScriptDraft;
          warnings?: string[];
          mode?: string;
          idempotent?: boolean;
          downstreamSync?: { syncStatus?: string };
        };
        if (
          seq !== splitRequestSeqRef.current ||
          importSeqAtStart !== importSeqRef.current
        ) {
          throw new Error("已取消");
        }
        if (payload.draft) {
          applyDraftToState(payload.draft, draftSetters);
        }
        if (!res.ok) {
          responseHandled = true;
          const message = payload.error ?? "本地分集失败";
          if (!payload.draft) {
            setEpisodeSplit((prev) => ({
              ...(prev ?? emptyEpisodeSplitState()),
              status: "failed",
              generationId: null,
              errorMessage: message,
            }));
          }
          throw new Error(message);
        }
        const warn =
          payload.warnings && payload.warnings.length > 0
            ? payload.warnings
            : [];
        openExtractPromptAfterConfirm(
          payload.draft?.episodeSplit?.sourceFingerprint,
          payload.idempotent,
        );
        return formatScriptAutoSplitNote({
          episodeCount: payload.draft?.episodes.length ?? 0,
          mode: payload.mode,
          warnings: warn,
          idempotent: payload.idempotent,
          downstreamSync: payload.downstreamSync?.syncStatus ?? null,
        });
      } catch (error) {
        if (
          seq !== splitRequestSeqRef.current ||
          importSeqAtStart !== importSeqRef.current
        ) {
          throw error instanceof Error ? error : new Error("已取消");
        }
        const message =
          error instanceof Error ? error.message : "分集失败，请稍后重试";
        if (
          !responseHandled &&
          message !== "已取消" &&
          message !== "分集进行中，请稍候"
        ) {
          setEpisodeSplit((prev) => ({
            ...(prev ?? emptyEpisodeSplitState()),
            status: "failed",
            generationId: null,
            errorMessage: message,
          }));
        }
        throw error instanceof Error ? error : new Error(message);
      } finally {
        if (seq === splitRequestSeqRef.current) {
          splitInFlightRef.current = false;
          setSplitGenerating(false);
          setSplitStage("");
        }
      }
    },
    [draftSetters, openExtractPromptAfterConfirm, projectId],
  );

  const handleConfirmImport = useCallback(async () => {
    if (!importPreview || confirmingImport || splitInFlightRef.current) return;
    setUiNote("");
    const preview = importPreview;
    try {
      await persistImportedScriptAndAutoSplit(preview);
    } catch (error) {
      setUiNote(error instanceof Error ? error.message : "保存失败");
    }
  }, [
    confirmingImport,
    importPreview,
    persistImportedScriptAndAutoSplit,
  ]);

  const handleStartSplit = useCallback(async () => {
    if (splitInFlightRef.current || confirmingImport || importing) return;
    if (!sourceText?.trim()) {
      setUiNote("剧本导入后会自动分集。若已导入仍失败，请点击重新分集。");
      return;
    }
    setUiNote("");
    try {
      const note = await runLocalSplit({
        body: {},
        stageMessage: "正在自动生成分集方案…",
      });
      setUiNote(note);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "分集失败，请稍后重试";
      if (message !== "已取消" && message !== "分集进行中，请稍候") {
        setUiNote(`自动分集失败，请点击重新分集。${message}`);
      }
    }
  }, [
    confirmingImport,
    importing,
    runLocalSplit,
    sourceText,
  ]);

  const handleCancelSplit = useCallback(async () => {
    splitRequestSeqRef.current += 1;
    splitInFlightRef.current = false;
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
    setUiNote("手动分集规则仅作备用；上传剧本后将自动分集并创建剧集。");
    void splitScriptEpisodes({
      projectId,
      ...splitConfig,
    }).catch(() => {
      /* stub */
    });
  }, [projectId, splitConfig]);

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

  const flushSave = useCallback(
    async (options?: { keepalive?: boolean }) => {
      if (savingRef.current) return;
      if (!dirtyRef.current) return;
      if (
        !hydrated ||
        importing ||
        confirmingImport ||
        splitGenerating
      ) {
        return;
      }

      savingRef.current = true;
      dirtyRef.current = false;

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
      const nextSplit: ScriptEpisodeSplitState = {
        ...episodeSplit,
        proposedEpisodes:
          episodeSplit.status === "review"
            ? proposedEpisodes
            : episodeSplit.proposedEpisodes,
      };

      if (options?.keepalive) {
        void fetch(
          `/api/projects/${encodeURIComponent(projectId)}/script-draft`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            keepalive: true,
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
        savingRef.current = false;
        return;
      }

      setSaving(true);
      setUiNote("");
      try {
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
        nextSplit.proposedEpisodes = nextProposed;
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
        setUiNote("已自动保存。");
      } catch (error) {
        dirtyRef.current = true;
        setUiNote(error instanceof Error ? error.message : "保存失败");
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [
      confirmingImport,
      draftSetters,
      episodeSplit,
      episodes,
      hydrated,
      importing,
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
      splitGenerating,
    ],
  );

  const flushSaveIfDirty = useCallback(() => {
    if (dirtyRef.current && !savingRef.current) {
      void flushSave();
    }
  }, [flushSave]);

  useEffect(() => {
    const onPageHide = () => {
      if (dirtyRef.current && !savingRef.current) {
        void flushSave({ keepalive: true });
      }
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [flushSave]);

  const handleWorkspacePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const textarea = editorTextareaRef.current;
      if (!textarea || !dirtyRef.current || savingRef.current) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (textarea === target || textarea.contains(target)) return;
      void flushSave();
    },
    [flushSave],
  );

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
  const showFormalEpisodeList = scriptShowsFormalEpisodeList({
    splitStatus: episodeSplit.status,
    formalEpisodeCount: episodes.length,
  });
  const showSplitReview =
    !showFormalEpisodeList &&
    (splitInReview ||
      episodeSplit.status === "failed" ||
      episodeSplit.status === "stale");
  const fabDisabled =
    !canGoNext || splitGenerating || confirmingSplit || confirmingImport;
  const fabTitle = splitConfirmed
    ? undefined
    : splitInReview
      ? "确认分集方案并进入资产设计"
      : "请先上传剧本；上传成功后将自动分集并创建剧集";

  return (
    <div className="scw-script">
      <div className="scs-inner" onPointerDownCapture={handleWorkspacePointerDown}>
        <div
          className={`scs-grid${
            sourceText?.trim() || sourceFile ? " is-no-source" : ""
          }`}
        >
          {!sourceText?.trim() && !sourceFile ? (
            <section className="scs-panel scs-panel--source" aria-label="剧本来源">
              <h2>剧本输入</h2>
              <ScriptUploadPanel
                file={sourceFile}
                importing={importing || confirmingImport || splitGenerating}
                onScriptFile={(file) => {
                  void handleScriptFile(file);
                }}
                onRemove={() => {
                  void handleRemoveUploadedScript();
                }}
                onClientError={(message) => {
                  importSeqRef.current += 1;
                  splitRequestSeqRef.current += 1;
                  splitInFlightRef.current = false;
                  setSplitGenerating(false);
                  setSplitStage("");
                  setImportPreview(null);
                  setUiNote(message);
                }}
              />
            </section>
          ) : null}

          <section
            className="scs-panel scs-panel--process"
            aria-label="剧本读取处理"
          >
            <h2>剧本读取处理</h2>
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
            {loadError ? (
              <p className="scs-error" role="alert">
                {loadError}
              </p>
            ) : null}
            {uiNote ? (
              <p
                className="scs-ui-note"
                data-testid="script-auto-split-note"
                role="status"
              >
                {uiNote}
              </p>
            ) : null}
            {episodeSplit.status === "failed" && episodeSplit.errorMessage ? (
              <p className="scs-error" role="alert">
                {episodeSplit.errorMessage}
              </p>
            ) : null}

            {showSplitReview ? (
              <ScriptProcessPanel
                embedded
                numbersOnly
                episodes={proposedEpisodes.map((ep) => ({
                  id: ep.id,
                  episodeNumber: ep.episodeNumber,
                  title: ep.title,
                }))}
                selectedId={selectedId}
                page={listPage}
                emptyHint="无法识别分集或尚未上传剧本。"
                onSelect={(id) => {
                  setSelectedId(id);
                }}
                onPageChange={setListPage}
              />
            ) : (
              <ScriptProcessPanel
                embedded
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
          </section>

          <ScriptDocumentEditor
            reviewMode={showSplitReview}
            disabled={splitGenerating || confirmingSplit || saving}
            textareaRef={editorTextareaRef}
            onBlur={flushSaveIfDirty}
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
              dirtyRef.current = true;
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
            {sourceText?.trim() || sourceFile
              ? "请核对分集并确认剧本"
              : "上传剧本后将自动分集并创建剧集"}
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

      {extractPromptOpen && extractPromptFingerprint ? (
        <ScriptConfirmExtractDialog
          open={extractPromptOpen}
          projectId={projectId}
          sourceFingerprint={extractPromptFingerprint}
          onLater={() => {
            setExtractPromptOpen(false);
            setExtractPromptFingerprint(null);
          }}
          onExtractStarted={() => {
            setExtractPromptOpen(false);
            setExtractPromptFingerprint(null);
            goToAssets();
          }}
        />
      ) : null}
    </div>
  );
}
