"use client";

import dynamic from "next/dynamic";
import { Save, Send, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChipBounce } from "@/shell/useChipBounce";
import { GlassSelect } from "@/shell/glass-select";
import { AssetTabs } from "@/projects/assets/AssetTabs";
import { AssetExtractionToolbar } from "@/projects/assets/AssetExtractionToolbar";
import type {
  AssetExtractionEpisode,
} from "@/projects/assets/EpisodeAssetDesignWorkspace";
import type { EpisodeAssetDesignItem } from "@/projects/assets/episode-design/types";
import { CharacterManager } from "@/projects/assets/CharacterManager";
import { SceneManager } from "@/projects/assets/SceneManager";
import { PropManager } from "@/projects/assets/PropManager";
import { persistAssetBundle } from "@/projects/assets/persist-asset-bundle";
import { persistLibraryDesignItems } from "@/projects/assets/persist-library-design-items";
import { UnsavedPromptDialog } from "@/projects/assets/UnsavedPromptDialog";
import { ScriptAssetExtractPromptCard } from "@/projects/script/ScriptAssetExtractPromptCard";
import { defaultAssetExtractionModelKey } from "@/projects/assets/extraction/models";
import {
  ASSET_EXTRACTION_MISSING_HINT,
  isCompletedExtractionStatus,
  isLiveExtractionStatus,
} from "@/projects/assets/extraction/types";
import type { ExtractedAsset } from "@/projects/assets/extraction/types";
import type {
  AssetTabId,
  AudioAsset,
  CharacterAsset,
  ProjectAssetBundle,
  PropAsset,
  SceneAsset,
} from "@/projects/assets/types";
import "@/projects/assets/asset-workspace.css";
import { InterruptedImageJobsDialog } from "@/projects/assets/image-generation/InterruptedImageJobsDialog";
import type { ImageJobPublic } from "@/projects/assets/image-generation/useLibraryImageGenerationJob";

const EpisodeAssetDesignWorkspace = dynamic(
  () =>
    import("@/projects/assets/EpisodeAssetDesignWorkspace").then((mod) => ({
      default: mod.EpisodeAssetDesignWorkspace,
    })),
  { ssr: false },
);

const ALL_EPISODES_VALUE = "__all__";

function mergeScopedAssets<T extends { id: string }>(
  allItems: T[],
  scopedItems: T[],
  scopeIds: Set<string> | null,
): T[] {
  if (!scopeIds) return scopedItems;
  const scopedById = new Map(scopedItems.map((item) => [item.id, item]));
  const existingIds = new Set(allItems.map((item) => item.id));
  return [
    ...allItems.map((item) =>
      scopeIds.has(item.id) ? (scopedById.get(item.id) ?? item) : item,
    ),
    ...scopedItems.filter((item) => !existingIds.has(item.id)),
  ];
}

type Props = {
  projectId: string;
  /** management：项目管理资产；workspace：工作台资产 */
  context?: "management" | "workspace";
  /** 嵌入 ProjectAssetsShell 时隐藏外层标题与容器 */
  embedded?: boolean;
  /** 返回链接（工作台上下文） */
  backHref?: string;
  backLabel?: string;
};

export type PersistAssetPatch = Partial<
  Pick<ProjectAssetBundle, "characters" | "scenes" | "props" | "audios">
>;

export function AssetManagementWorkspace({
  projectId,
  context = "management",
  embedded = false,
  backHref,
  backLabel = "返回",
}: Props) {
  const saveBounce = useChipBounce();
  const [projectName, setProjectName] = useState("");
  const [loadError, setLoadError] = useState("");
  const [pageNote, setPageNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<AssetTabId>("character");
  const [tabKey, setTabKey] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [approvalEnabled, setApprovalEnabled] = useState(false);
  const [extractionBusy, setExtractionBusy] = useState(false);
  const approvalRequestSeq = useRef(0);
  const [submitApprovalRequestId, setSubmitApprovalRequestId] = useState(0);
  const [episodePickerOpen, setEpisodePickerOpen] = useState(false);
  const [extractionEpisodes, setExtractionEpisodes] = useState<
    AssetExtractionEpisode[]
  >([]);
  const [selectedExtractionEpisodeId, setSelectedExtractionEpisodeId] =
    useState("");
  const [viewEpisodeId, setViewEpisodeId] = useState<string | null>(null);
  const [viewEpisodeAssetIds, setViewEpisodeAssetIds] = useState<
    string[] | null
  >(null);
  const [designItems, setDesignItems] = useState<EpisodeAssetDesignItem[]>([]);
  const [designEpisodeId, setDesignEpisodeId] = useState("");
  const [extractedAssets, setExtractedAssets] = useState<ExtractedAsset[]>([]);
  const [hasActiveVersion, setHasActiveVersion] = useState(false);
  const [extractionSuccess, setExtractionSuccess] = useState(false);
  const [candidateNeedsReview, setCandidateNeedsReview] = useState(false);
  const [restartAvailable, setRestartAvailable] = useState(false);
  const [extractPromptAvailable, setExtractPromptAvailable] = useState(false);
  const [extractPromptDismissed, setExtractPromptDismissed] = useState(false);
  const [restartErrorMessage, setRestartErrorMessage] = useState<string | null>(
    null,
  );
  const [restartStarting, setRestartStarting] = useState(false);
  const [restartModelKey, setRestartModelKey] = useState(
    defaultAssetExtractionModelKey(),
  );
  const extractionBusyRef = useRef(false);
  const extractionRefreshGenerationRef = useRef(0);
  const visibleTab: Exclude<AssetTabId, "audio"> =
    activeTab === "audio" ? "character" : activeTab;

  const isWorkspace = context === "workspace";
  const [characters, setCharacters] = useState<CharacterAsset[]>([]);
  const [scenes, setScenes] = useState<SceneAsset[]>([]);
  const [props, setProps] = useState<PropAsset[]>([]);
  const [audios, setAudios] = useState<AudioAsset[]>([]);
  const [interruptedJobs, setInterruptedJobs] = useState<ImageJobPublic[]>([]);
  const [interruptedOpen, setInterruptedOpen] = useState(false);
  const interruptedShownRef = useRef(false);
  const draftFetchGenerationRef = useRef(0);
  const libraryPromptFlushRef = useRef<(() => Promise<void>) | null>(null);
  const [libraryPromptDirty, setLibraryPromptDirty] = useState(false);
  const [pendingTab, setPendingTab] = useState<Exclude<AssetTabId, "audio"> | null>(
    null,
  );
  const [unsavedBusy, setUnsavedBusy] = useState(false);

  useEffect(() => {
    setExtractPromptDismissed(false);
  }, [projectId]);

  const editAllowed = canEdit;

  const handleDesignItemChange = useCallback((nextItem: EpisodeAssetDesignItem) => {
    setDesignItems((previous) => {
      const index = previous.findIndex((item) => item.id === nextItem.id);
      if (index < 0) return [...previous, nextItem];
      const next = [...previous];
      next[index] = nextItem;
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const generation = draftFetchGenerationRef.current + 1;
    draftFetchGenerationRef.current = generation;
    void (async () => {
      try {
        const draftUrl = isWorkspace
          ? `/api/workspace/projects/${encodeURIComponent(projectId)}/assets-draft`
          : `/api/projects/${encodeURIComponent(projectId)}/assets-draft`;
        const res = await fetch(draftUrl, { credentials: "include" });
        if (cancelled || generation !== draftFetchGenerationRef.current) return;
        if (!res.ok) {
          setLoadError("无法加载资产草稿");
          setCanEdit(false);
          setCharacters([]);
          setScenes([]);
          setProps([]);
          setAudios([]);
          const metaUrl = isWorkspace
            ? `/api/workspace/projects/${encodeURIComponent(projectId)}`
            : `/api/projects/${encodeURIComponent(projectId)}`;
          const meta = await fetch(metaUrl, { credentials: "include" });
          if (meta.ok) {
            const metaText = await meta.text();
            if (metaText.trim()) {
              const data = JSON.parse(metaText) as {
                project?: { name?: string; approvalEnabled?: boolean };
              };
              setProjectName(data.project?.name ?? "");
              setApprovalEnabled(data.project?.approvalEnabled === true);
            }
          }
          return;
        }
        const draftText = await res.text();
        if (cancelled || generation !== draftFetchGenerationRef.current) return;
        if (!draftText.trim()) {
          setLoadError("无法加载资产草稿");
          return;
        }
        const data = JSON.parse(draftText) as {
          project?: { name?: string; approvalEnabled?: boolean };
          draft?: ProjectAssetBundle | null;
          canEdit?: boolean;
        };
        if (cancelled || generation !== draftFetchGenerationRef.current) return;
        setProjectName(data.project?.name ?? "");
        setApprovalEnabled(data.project?.approvalEnabled === true);
        setCanEdit(data.canEdit !== false && res.ok);
        if (data.draft) {
          setCharacters(data.draft.characters ?? []);
          setScenes(data.draft.scenes ?? []);
          setProps(data.draft.props ?? []);
          setAudios(data.draft.audios ?? []);
        } else {
          setCharacters([]);
          setScenes([]);
          setProps([]);
          setAudios([]);
        }
        setLoadError("");
      } catch {
        if (!cancelled && generation === draftFetchGenerationRef.current) {
          setLoadError("无法加载资产草稿");
        }
      } finally {
        if (!cancelled && generation === draftFetchGenerationRef.current) {
          setHydrated(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isWorkspace, projectId]);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    void (async () => {
      const root = isWorkspace
        ? `/api/workspace/projects/${encodeURIComponent(projectId)}`
        : `/api/projects/${encodeURIComponent(projectId)}`;
      const res = await fetch(`${root}/assets-draft/media/jobs`, {
        credentials: "include",
      });
      if (!res.ok || cancelled) return;
      const payload = (await res.json().catch(() => ({}))) as {
        interruptedJobs?: ImageJobPublic[];
      };
      const interrupted = (payload.interruptedJobs ?? []).filter(
        (job) =>
          (job.errorCode === "PROCESS_RESTARTED" ||
            job.errorCode === "PROCESS_SHUTDOWN") &&
          (job.status === "failed" || job.status === "save_failed"),
      );
      if (cancelled) return;
      setInterruptedJobs(interrupted);
      if (interrupted.length > 0 && !interruptedShownRef.current) {
        interruptedShownRef.current = true;
        setInterruptedOpen(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, isWorkspace, projectId]);

  const activeExtractionEpisodeId = extractionEpisodes.some(
    (episode) => episode.episodeId === selectedExtractionEpisodeId,
  )
    ? selectedExtractionEpisodeId
    : (extractionEpisodes[0]?.episodeId ?? "");
  const viewEpisodeOptions = useMemo(
    () => [
      { id: ALL_EPISODES_VALUE, label: "全部剧集资产" },
      ...extractionEpisodes.map((episode) => ({
        id: episode.episodeId,
        label: `第${episode.episodeNumber}集${episode.title ? ` · ${episode.title}` : ""}`,
      })),
    ],
    [extractionEpisodes],
  );
  const viewEpisodeValue = viewEpisodeId ?? ALL_EPISODES_VALUE;

  const pageLocked = extractionBusy;
  const scopedAssetIds = useMemo(
    () =>
      viewEpisodeAssetIds ? new Set(viewEpisodeAssetIds) : null,
    [viewEpisodeAssetIds],
  );
  const visibleCharacters = scopedAssetIds
    ? characters.filter((item) => scopedAssetIds.has(item.id))
    : characters;
  const visibleScenes = scopedAssetIds
    ? scenes.filter((item) => scopedAssetIds.has(item.id))
    : scenes;
  const visibleProps = scopedAssetIds
    ? props.filter((item) => scopedAssetIds.has(item.id))
    : props;

  const applyDraft = useCallback((draft: ProjectAssetBundle) => {
    setCharacters(draft.characters);
    setScenes(draft.scenes);
    setProps(draft.props);
    setAudios(draft.audios);
  }, []);

  const persist = useCallback(
    async (patch?: PersistAssetPatch) => {
      if (!editAllowed) {
        throw new Error("当前账号无资产编辑权限。");
      }
      const bundle: ProjectAssetBundle = {
        projectId,
        characters: patch?.characters ?? characters,
        scenes: patch?.scenes ?? scenes,
        props: patch?.props ?? props,
        audios: patch?.audios ?? audios,
      };
      const draft = await persistAssetBundle(
        projectId,
        bundle,
        isWorkspace ? "workspace" : "management",
      );
      applyDraft(draft);
      return draft;
    },
    [applyDraft, audios, characters, editAllowed, isWorkspace, projectId, props, scenes],
  );

  const refreshAssetDraft = useCallback(async () => {
    const generation = draftFetchGenerationRef.current + 1;
    draftFetchGenerationRef.current = generation;
    const draftUrl = isWorkspace
      ? `/api/workspace/projects/${encodeURIComponent(projectId)}/assets-draft`
      : `/api/projects/${encodeURIComponent(projectId)}/assets-draft`;
    const response = await fetch(draftUrl, { credentials: "include" });
    if (!response.ok) {
      throw new Error("无法刷新资产列表");
    }
    const payload = (await response.json()) as {
      draft?: ProjectAssetBundle | null;
    };
    if (generation !== draftFetchGenerationRef.current) {
      return payload.draft ?? null;
    }
    if (payload.draft) {
      applyDraft(payload.draft);
    } else {
      applyDraft({
        projectId,
        characters: [],
        scenes: [],
        props: [],
        audios: [],
      });
    }
    return payload.draft ?? null;
  }, [applyDraft, isWorkspace, projectId]);

  const handleExtractionComplete = useCallback(async () => {
    const generation = extractionRefreshGenerationRef.current + 1;
    extractionRefreshGenerationRef.current = generation;
    try {
      await refreshAssetDraft();
      if (generation !== extractionRefreshGenerationRef.current) return;
      setExtractionSuccess(true);
      if (approvalEnabled) {
        setPageNote("资产已提取，等待审批后进入正式资产库。");
      } else {
        setPageNote("提取完成，资产列表已刷新。");
      }
    } catch (error) {
      if (generation !== extractionRefreshGenerationRef.current) return;
      setPageNote(
        error instanceof Error
          ? error.message
          : "提取完成，但刷新资产列表失败。",
      );
    }
  }, [approvalEnabled, refreshAssetDraft]);

  useEffect(() => {
    let cancelled = false;
    const apiRoot = isWorkspace
      ? `/api/workspace/projects/${encodeURIComponent(projectId)}`
      : `/api/projects/${encodeURIComponent(projectId)}`;
    const loadSnapshot = async () => {
      const res = await fetch(`${apiRoot}/asset-extraction`, {
        credentials: "include",
      });
      if (!res.ok || cancelled) return;
      const payload = (await res.json()) as {
        hasActiveVersion?: boolean;
        assets?: ExtractedAsset[];
        conflicts?: unknown[];
        candidateAssets?: unknown[];
        task?: { status?: string } | null;
        restartAvailable?: boolean;
        restartErrorMessage?: string | null;
        extractPromptAvailable?: boolean;
        lastSuccessfulModelKey?: string | null;
        episodes?: Array<{
          episodeId: string;
          episodeNumber: number;
          title: string;
          extracted: boolean;
        }>;
      };
      if (cancelled) return;
      setHasActiveVersion(payload.hasActiveVersion === true);
      setExtractedAssets(payload.assets ?? []);
      setCandidateNeedsReview(
        (payload.conflicts?.length ?? 0) > 0 &&
          (payload.candidateAssets?.length ?? 0) > 0,
      );
      if (Array.isArray(payload.episodes) && payload.episodes.length > 0) {
        setExtractionEpisodes(
          payload.episodes.map((episode) => ({
            episodeId: episode.episodeId,
            episodeNumber: episode.episodeNumber,
            title: episode.title,
            designStatus: episode.extracted ? "review" : "not_started",
            itemCount: 0,
          })),
        );
      }
      const live = isLiveExtractionStatus(payload.task?.status);
      if (extractionBusyRef.current && !live) {
        if (isCompletedExtractionStatus(payload.task?.status)) {
          void handleExtractionComplete();
        }
      }
      extractionBusyRef.current = live;
      setExtractionBusy(live);
      setRestartAvailable(payload.restartAvailable === true);
      setExtractPromptAvailable(payload.extractPromptAvailable === true);
      setRestartErrorMessage(payload.restartErrorMessage ?? null);
      if (payload.lastSuccessfulModelKey) {
        setRestartModelKey(payload.lastSuccessfulModelKey);
      }
    };
    void loadSnapshot();
    const timer = window.setInterval(() => {
      void loadSnapshot();
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [handleExtractionComplete, isWorkspace, projectId]);

  const viewEpisodeAssets = useCallback(
    async (episodeId: string) => {
      if (episodeId === ALL_EPISODES_VALUE) {
        setViewEpisodeId(null);
        setViewEpisodeAssetIds(null);
        setPageNote("已显示全部剧集资产。");
        return;
      }

      const episode = extractionEpisodes.find(
        (item) => item.episodeId === episodeId,
      );
      const episodeAssets = extractedAssets.filter((asset) =>
        asset.sourceEpisodeIds.includes(episodeId),
      );
      const assetIds = Array.from(
        new Set(
          episodeAssets
            .map((asset) => asset.libraryAssetId?.trim())
            .filter((id): id is string => Boolean(id)),
        ),
      );

      setViewEpisodeId(episodeId);
      setViewEpisodeAssetIds(assetIds);
      setPageNote(
        `正在查看第 ${episode?.episodeNumber ?? "-"} 集资产 · 共 ${assetIds.length} 项`,
      );
    },
    [extractedAssets, extractionEpisodes],
  );

  const requestEpisodeExtraction = useCallback(
    async (episodeId: string) => {
      if (extractionBusy) return;
      const apiRoot = isWorkspace
        ? `/api/workspace/projects/${encodeURIComponent(projectId)}`
        : `/api/projects/${encodeURIComponent(projectId)}`;
      const res = await fetch(`${apiRoot}/asset-extraction/tasks`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "episode", episodeId }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setPageNote(payload.error ?? "无法开始提取本集资产");
        return;
      }
      setExtractionBusy(true);
    },
    [extractionBusy, isWorkspace, projectId],
  );

  const restartExtraction = useCallback(async () => {
    if (extractionBusy || restartStarting) return;
    const apiRoot = isWorkspace
      ? `/api/workspace/projects/${encodeURIComponent(projectId)}`
      : `/api/projects/${encodeURIComponent(projectId)}`;
    setRestartStarting(true);
    const res = await fetch(`${apiRoot}/asset-extraction/tasks`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: "all",
        modelKey: restartModelKey,
      }),
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      setPageNote(payload.error ?? "无法重新开始提取");
      setRestartStarting(false);
      return;
    }
    setRestartAvailable(false);
    setExtractPromptAvailable(false);
    setExtractPromptDismissed(true);
    setRestartErrorMessage(null);
    setExtractionBusy(true);
    setRestartStarting(false);
  }, [
    extractionBusy,
    isWorkspace,
    projectId,
    restartModelKey,
    restartStarting,
  ]);

  const handleSavePage = useCallback(async () => {
    if (!editAllowed) {
      setPageNote("当前账号无资产编辑权限。");
      return;
    }
    setSaving(true);
    setPageNote("");
    try {
      await libraryPromptFlushRef.current?.();
      if (designEpisodeId && designItems.length > 0) {
        await persistLibraryDesignItems({
          projectId,
          context: isWorkspace ? "workspace" : "management",
          episodeId: designEpisodeId,
          items: designItems,
        });
      }
      await persist();
      setLibraryPromptDirty(false);
      setPageNote("已保存。");
    } catch (error) {
      setPageNote(
        error instanceof Error ? error.message : "保存失败，请稍后重试",
      );
    } finally {
      setSaving(false);
    }
  }, [
    designEpisodeId,
    designItems,
    editAllowed,
    isWorkspace,
    persist,
    projectId,
  ]);

  const applyTabChange = useCallback((tab: Exclude<AssetTabId, "audio">) => {
    setActiveTab(tab);
    setTabKey((k) => k + 1);
    setPageNote("");
    setLibraryPromptDirty(false);
  }, []);

  const requestTabChange = useCallback(
    (tab: AssetTabId) => {
      if (tab === "audio") return;
      if (libraryPromptDirty && tab !== visibleTab) {
        setPendingTab(tab);
        return;
      }
      applyTabChange(tab);
    },
    [applyTabChange, libraryPromptDirty, visibleTab],
  );

  const handleUnsavedTabSave = useCallback(async () => {
    if (!pendingTab) return;
    setUnsavedBusy(true);
    try {
      await libraryPromptFlushRef.current?.();
      if (designEpisodeId && designItems.length > 0) {
        await persistLibraryDesignItems({
          projectId,
          context: isWorkspace ? "workspace" : "management",
          episodeId: designEpisodeId,
          items: designItems,
        });
      }
      await persist();
      const nextTab = pendingTab;
      setPendingTab(null);
      setLibraryPromptDirty(false);
      applyTabChange(nextTab);
      setPageNote("已保存。");
    } catch (error) {
      setPageNote(
        error instanceof Error ? error.message : "保存失败，请稍后重试",
      );
    } finally {
      setUnsavedBusy(false);
    }
  }, [
    applyTabChange,
    designEpisodeId,
    designItems,
    isWorkspace,
    pendingTab,
    persist,
    projectId,
  ]);

  return (
    <div
      className={
        embedded
          ? "amw-library-workspace asset-library-page"
          : "amw asset-library-page"
      }
      aria-busy={pageLocked}
    >
      <div
        className={
          embedded
            ? "amw-library-workspace__inner asset-library-page__inner"
            : "amw-inner asset-library-page__inner"
        }
        inert={pageLocked ? true : undefined}
      >
        <div className="asset-library-toolbar">
          <div className="asset-library-toolbar--unified">
            <AssetTabs
              active={visibleTab}
              onChange={requestTabChange}
            />
            <AssetExtractionToolbar
              onExtractEpisode={() => {
                setSelectedExtractionEpisodeId(
                  extractionEpisodes[0]?.episodeId ?? "",
                );
                setEpisodePickerOpen(true);
              }}
              viewEpisodeOptions={viewEpisodeOptions}
              viewEpisodeValue={viewEpisodeValue}
              onViewEpisodeAssets={(episodeId) => {
                void viewEpisodeAssets(episodeId);
              }}
              extracting={pageLocked}
              extractLabel="提取本集资产"
              trailing={
                <>
                  {isWorkspace && approvalEnabled ? (
                    <button
                      type="button"
                      className="amw-btn"
                      disabled={!editAllowed || pageLocked || !hydrated}
                      onClick={() => {
                        approvalRequestSeq.current += 1;
                        setSubmitApprovalRequestId(approvalRequestSeq.current);
                      }}
                      data-testid="asset-submit-approval"
                    >
                      <Send size={16} aria-hidden />
                      提交审批
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={`amw-btn amw-btn-primary asset-library-toolbar__save ${saveBounce.bounceClass}`}
                    disabled={!editAllowed || saving || pageLocked || !hydrated}
                    onClick={() => {
                      saveBounce.trigger();
                      void handleSavePage();
                    }}
                    onAnimationEnd={saveBounce.onAnimationEnd}
                    data-testid="asset-library-save"
                  >
                    <Save size={16} aria-hidden />
                    {saving ? "保存中…" : "保存"}
                  </button>
                </>
              }
            />
          </div>
          {extractionSuccess ? (
            <p className="asset-library-toolbar__note" role="status">
              重新提取结果已应用。
              <button
                type="button"
                className="amw-btn"
                onClick={() => setExtractionSuccess(false)}
              >
                关闭
              </button>
            </p>
          ) : null}
          {candidateNeedsReview ? (
            <p className="asset-library-toolbar__note" role="status">
              存在需确认的人工修改冲突。
              <a
                href={`${isWorkspace ? "/app/workspace/projects" : "/app/projects"}/${encodeURIComponent(projectId)}/assets/extraction-review`}
              >
                打开重新提取结果确认
              </a>
            </p>
          ) : null}
          {hydrated && !hasActiveVersion && !extractionBusy ? (
            <p
              className="asset-library-toolbar__note"
              data-testid="asset-empty-state"
            >
              当前还没有已确认的资产。请先确认剧本后提取，或选择剧集提取本集资产。
            </p>
          ) : null}
          {pageNote || loadError || !hydrated ? (
            <p className="asset-library-toolbar__note" role="status">
              {!hydrated
                ? "加载中…"
                : loadError
                  ? loadError
                  : pageNote}
            </p>
          ) : null}
          {hasActiveVersion ? (
            <p className="asset-library-toolbar__note" role="note">
              {ASSET_EXTRACTION_MISSING_HINT}
            </p>
          ) : null}
        </div>

        <div className="asset-library-content">
          <div
            className="asset-library-library-surface"
            key={`${visibleTab}-${tabKey}-${viewEpisodeId ?? "all"}`}
          >
          {visibleTab === "character" ? (
            <CharacterManager
              projectId={projectId}
              context={context}
              characters={visibleCharacters}
              audios={audios}
              canEdit={editAllowed}
              designItems={designItems}
              designEpisodeId={designEpisodeId}
              onDesignItemChange={handleDesignItemChange}
              onPromptDirtyChange={setLibraryPromptDirty}
              promptFlushRef={libraryPromptFlushRef}
              onChange={(nextCharacters) =>
                setCharacters(
                  mergeScopedAssets(
                    characters,
                    nextCharacters,
                    scopedAssetIds,
                  ),
                )
              }
              onPersist={async (nextCharacters) => {
                const merged = mergeScopedAssets(
                  characters,
                  nextCharacters,
                  scopedAssetIds,
                );
                setCharacters(merged);
                await persist({ characters: merged });
              }}
              onAudiosChange={setAudios}
              onPersistAudios={async (nextAudios) => {
                setAudios(nextAudios);
                await persist({ audios: nextAudios });
              }}
            />
          ) : null}
          {visibleTab === "scene" ? (
            <SceneManager
              projectId={projectId}
              context={context}
              scenes={visibleScenes}
              canEdit={editAllowed}
              designItems={designItems}
              designEpisodeId={designEpisodeId}
              onDesignItemChange={handleDesignItemChange}
              onPromptDirtyChange={setLibraryPromptDirty}
              promptFlushRef={libraryPromptFlushRef}
              onChange={(nextScenes) =>
                setScenes(
                  mergeScopedAssets(scenes, nextScenes, scopedAssetIds),
                )
              }
              onPersist={async (nextScenes) => {
                const merged = mergeScopedAssets(
                  scenes,
                  nextScenes,
                  scopedAssetIds,
                );
                setScenes(merged);
                await persist({ scenes: merged });
              }}
            />
          ) : null}
          {visibleTab === "prop" ? (
            <PropManager
              projectId={projectId}
              context={context}
              props={visibleProps}
              canEdit={editAllowed}
              designItems={designItems}
              designEpisodeId={designEpisodeId}
              onDesignItemChange={handleDesignItemChange}
              onPromptDirtyChange={setLibraryPromptDirty}
              promptFlushRef={libraryPromptFlushRef}
              onChange={(nextProps) =>
                setProps(
                  mergeScopedAssets(props, nextProps, scopedAssetIds),
                )
              }
              onPersist={async (nextProps) => {
                const merged = mergeScopedAssets(
                  props,
                  nextProps,
                  scopedAssetIds,
                );
                setProps(merged);
                await persist({ props: merged });
              }}
            />
          ) : null}
          </div>

          <EpisodeAssetDesignWorkspace
            projectId={projectId}
            headless
            showApprovalUi={approvalEnabled}
            approvalEnabled={approvalEnabled}
            submitApprovalRequestId={submitApprovalRequestId}
            onExtractionComplete={async () => {
              await handleExtractionComplete();
            }}
            onEpisodesChange={setExtractionEpisodes}
            onItemsChange={(nextItems, episodeId) => {
              setDesignItems(nextItems);
              setDesignEpisodeId(episodeId);
            }}
          />
        </div>
      </div>

      {episodePickerOpen ? (
        <div
          className="asset-episode-picker"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setEpisodePickerOpen(false);
          }}
        >
          <section
            className="asset-episode-picker__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="asset-episode-picker-title"
          >
            <header className="asset-episode-picker__head">
              <h2 id="asset-episode-picker-title">选择提取剧集</h2>
              <button
                type="button"
                className="asset-episode-picker__close"
                aria-label="关闭剧集选择"
                title="关闭"
                onClick={() => setEpisodePickerOpen(false)}
              >
                <X size={16} aria-hidden />
              </button>
            </header>
            <GlassSelect
              label="剧集"
              menuPortal
              placeholder={
                extractionEpisodes.length > 0 ? "请选择剧集" : "暂无可提取剧集"
              }
              value={activeExtractionEpisodeId}
              options={extractionEpisodes.map((episode) => ({
                id: episode.episodeId,
                label: `第 ${episode.episodeNumber} 集${
                  episode.title ? ` · ${episode.title}` : ""
                }`,
              }))}
              disabled={extractionEpisodes.length === 0}
              onChange={setSelectedExtractionEpisodeId}
            />
            <footer className="asset-episode-picker__actions">
              <button
                type="button"
                className="amw-btn"
                onClick={() => setEpisodePickerOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="amw-btn amw-btn-primary"
                disabled={!activeExtractionEpisodeId}
                onClick={() => {
                  void requestEpisodeExtraction(activeExtractionEpisodeId);
                  setEpisodePickerOpen(false);
                }}
              >
                开始提取
              </button>
            </footer>
          </section>
        </div>
      ) : null}
      <ScriptAssetExtractPromptCard
        open={
          !extractionBusy &&
          (restartAvailable ||
            (extractPromptAvailable && !extractPromptDismissed))
        }
        modelKey={restartModelKey}
        starting={restartStarting}
        errorMessage={restartAvailable ? restartErrorMessage : null}
        onModelKeyChange={setRestartModelKey}
        onSkip={() => {
          if (restartAvailable) {
            setRestartAvailable(false);
            return;
          }
          setExtractPromptDismissed(true);
        }}
        onStart={() => {
          void restartExtraction();
        }}
      />
      <InterruptedImageJobsDialog
        projectId={projectId}
        context={context}
        open={interruptedOpen}
        jobs={interruptedJobs}
        onClose={() => setInterruptedOpen(false)}
        onRetried={() => {
          setInterruptedOpen(false);
          setPageNote("已提交重新生成，可在对应素材查看进度。");
        }}
      />
      <UnsavedPromptDialog
        open={pendingTab != null}
        busy={unsavedBusy}
        onSave={() => void handleUnsavedTabSave()}
        onDiscard={() => {
          if (!pendingTab) return;
          const nextTab = pendingTab;
          setPendingTab(null);
          setLibraryPromptDirty(false);
          applyTabChange(nextTab);
        }}
        onCancel={() => setPendingTab(null)}
      />
    </div>
  );
}
