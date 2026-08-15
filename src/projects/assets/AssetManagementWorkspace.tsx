"use client";

import dynamic from "next/dynamic";
import { Save, Send, Users, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChipBounce } from "@/shell/useChipBounce";
import { GlassSelect } from "@/shell/glass-select";
import { AssetTabs } from "@/projects/assets/AssetTabs";
import {
  AssetExtractionToolbar,
  type AssetExtractionMode,
} from "@/projects/assets/AssetExtractionToolbar";
import type {
  AssetExtractionEpisode,
  AssetExtractionProgress,
  AssetExtractionRequest,
} from "@/projects/assets/EpisodeAssetDesignWorkspace";
import type { EpisodeAssetDesignItem } from "@/projects/assets/episode-design/types";
import { CharacterManager } from "@/projects/assets/CharacterManager";
import { SceneManager } from "@/projects/assets/SceneManager";
import { PropManager } from "@/projects/assets/PropManager";
import { buildMockAssetBundle } from "@/projects/assets/mock-data";
import { persistAssetBundle } from "@/projects/assets/persist-asset-bundle";
import type {
  AssetTabId,
  AudioAsset,
  CharacterAsset,
  ProjectAssetBundle,
  PropAsset,
  SceneAsset,
} from "@/projects/assets/types";
import "@/projects/assets/asset-workspace.css";

const EpisodeAssetDesignWorkspace = dynamic(
  () =>
    import("@/projects/assets/EpisodeAssetDesignWorkspace").then((mod) => ({
      default: mod.EpisodeAssetDesignWorkspace,
    })),
  { ssr: false },
);

const PREVIEW_EPISODES: AssetExtractionEpisode[] = [
  {
    episodeId: "episode-1",
    episodeNumber: 1,
    title: "雨夜来客",
    designStatus: "review",
    itemCount: 8,
  },
  {
    episodeId: "episode-2",
    episodeNumber: 2,
    title: "旧案重启",
    designStatus: "not_started",
    itemCount: 0,
  },
  {
    episodeId: "episode-3",
    episodeNumber: 3,
    title: "暗巷追踪",
    designStatus: "not_started",
    itemCount: 0,
  },
];

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
  /** Development-only visual review surface; skips remote loading. */
  previewMode?: boolean;
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
  previewMode = false,
}: Props) {
  const saveBounce = useChipBounce();
  const [projectName, setProjectName] = useState(
    previewMode ? "雨夜追凶" : "",
  );
  const [loadError, setLoadError] = useState("");
  const [pageNote, setPageNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<AssetTabId>("character");
  const [tabKey, setTabKey] = useState(0);
  const [hydrated, setHydrated] = useState(previewMode);
  const [canEdit, setCanEdit] = useState(previewMode);
  const [approvalEnabled, setApprovalEnabled] = useState(false);
  const [extractionBusy, setExtractionBusy] = useState(false);
  const [extractionProgress, setExtractionProgress] =
    useState<AssetExtractionProgress | null>(null);
  const [extractionRequest, setExtractionRequest] =
    useState<AssetExtractionRequest | null>(null);
  const extractionRequestSeq = useRef(0);
  const approvalRequestSeq = useRef(0);
  const [submitApprovalRequestId, setSubmitApprovalRequestId] = useState(0);
  const [episodePickerOpen, setEpisodePickerOpen] = useState(false);
  const [extractionEpisodes, setExtractionEpisodes] = useState<
    AssetExtractionEpisode[]
  >(previewMode ? PREVIEW_EPISODES : []);
  const [selectedExtractionEpisodeId, setSelectedExtractionEpisodeId] =
    useState(previewMode ? PREVIEW_EPISODES[0]!.episodeId : "");
  const [viewEpisodeId, setViewEpisodeId] = useState<string | null>(null);
  const [viewEpisodeAssetIds, setViewEpisodeAssetIds] = useState<
    string[] | null
  >(null);
  const [extractionModel, setExtractionModel] = useState("deepseek-v4-pro");
  const [designItems, setDesignItems] = useState<EpisodeAssetDesignItem[]>([]);
  const [designEpisodeId, setDesignEpisodeId] = useState("__full_script__");
  const previewExtractionIntervalRef = useRef<number | null>(null);
  const previewExtractionFinishRef = useRef<number | null>(null);
  const previewExtractionDoneRef = useRef<number | null>(null);
  const visibleTab: Exclude<AssetTabId, "audio"> =
    activeTab === "audio" ? "character" : activeTab;

  const isWorkspace = context === "workspace";
  const initial = useMemo(() => buildMockAssetBundle(projectId), [projectId]);
  const [characters, setCharacters] = useState<CharacterAsset[]>(
    () => initial.characters,
  );
  const [scenes, setScenes] = useState<SceneAsset[]>(() => initial.scenes);
  const [props, setProps] = useState<PropAsset[]>(() => initial.props);
  const [audios, setAudios] = useState<AudioAsset[]>(() => initial.audios);

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
    if (previewMode) return;
    let cancelled = false;
    void (async () => {
      try {
        const draftUrl = isWorkspace
          ? `/api/workspace/projects/${encodeURIComponent(projectId)}/assets-draft`
          : `/api/projects/${encodeURIComponent(projectId)}/assets-draft`;
        const res = await fetch(draftUrl, { credentials: "include" });
        if (!res.ok) {
          if (!cancelled) {
            setLoadError("无法加载资产草稿");
            setCanEdit(false);
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
          }
          return;
        }
        const draftText = await res.text();
        if (!draftText.trim()) {
          if (!cancelled) setLoadError("无法加载资产草稿");
          return;
        }
        const data = JSON.parse(draftText) as {
          project?: { name?: string; approvalEnabled?: boolean };
          draft?: ProjectAssetBundle | null;
          canEdit?: boolean;
        };
        if (cancelled) return;
        setProjectName(data.project?.name ?? "");
        setApprovalEnabled(data.project?.approvalEnabled === true);
        setCanEdit(data.canEdit !== false && res.ok);
        if (data.draft) {
          setCharacters(data.draft.characters ?? []);
          setScenes(data.draft.scenes ?? []);
          setProps(data.draft.props ?? []);
          setAudios(data.draft.audios ?? []);
        }
        setLoadError("");
      } catch {
        if (!cancelled) setLoadError("无法加载资产草稿");
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isWorkspace, previewMode, projectId]);

  useEffect(() => {
    return () => {
      if (previewExtractionIntervalRef.current !== null) {
        window.clearInterval(previewExtractionIntervalRef.current);
      }
      if (previewExtractionFinishRef.current !== null) {
        window.clearTimeout(previewExtractionFinishRef.current);
      }
      if (previewExtractionDoneRef.current !== null) {
        window.clearTimeout(previewExtractionDoneRef.current);
      }
    };
  }, []);

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

  const pageLocked = extractionBusy || extractionProgress !== null;
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
    if (previewMode) {
      setPageNote("提取任务已创建。当前为页面预览数据。");
      return;
    }
    const draftUrl = isWorkspace
      ? `/api/workspace/projects/${encodeURIComponent(projectId)}/assets-draft`
      : `/api/projects/${encodeURIComponent(projectId)}/assets-draft`;
    const response = await fetch(draftUrl, { credentials: "include" });
    if (!response.ok) return;
    const payload = (await response.json()) as {
      draft?: ProjectAssetBundle | null;
    };
    if (payload.draft) applyDraft(payload.draft);
    setPageNote("提取完成，资产列表已更新。");
  }, [applyDraft, isWorkspace, previewMode, projectId]);

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
      let assetIds: string[] = [];
      if (previewMode) {
        assetIds =
          episode?.episodeNumber === 1
            ? [
                ...characters.map((item) => item.id),
                ...scenes.map((item) => item.id),
                ...props.map((item) => item.id),
              ]
            : [];
      } else {
        try {
          const apiRoot = isWorkspace
            ? `/api/workspace/projects/${encodeURIComponent(projectId)}`
            : `/api/projects/${encodeURIComponent(projectId)}`;
          const response = await fetch(
            `${apiRoot}/asset-designs/episodes/${encodeURIComponent(episodeId)}`,
            { credentials: "include" },
          );
          if (!response.ok) throw new Error("无法加载单集资产");
          const payload = (await response.json()) as {
            record?: { items?: Array<{ libraryAssetId?: string | null }> };
          };
          assetIds = Array.from(
            new Set(
              (payload.record?.items ?? [])
                .map((item) => item.libraryAssetId?.trim())
                .filter((id): id is string => Boolean(id)),
            ),
          );
        } catch (error) {
          setPageNote(
            error instanceof Error ? error.message : "无法加载单集资产",
          );
          return;
        }
      }

      setViewEpisodeId(episodeId);
      setViewEpisodeAssetIds(assetIds);
      setPageNote(
        `正在查看第 ${episode?.episodeNumber ?? "-"} 集资产 · 共 ${assetIds.length} 项`,
      );
    },
    [
      characters,
      extractionEpisodes,
      isWorkspace,
      previewMode,
      projectId,
      props,
      scenes,
    ],
  );

  const requestExtraction = useCallback(
    (mode: AssetExtractionMode, episodeId?: string) => {
      extractionRequestSeq.current += 1;
      if (previewMode) {
        const episodeNumber = extractionEpisodes.find(
          (episode) => episode.episodeId === episodeId,
        )?.episodeNumber;
        const label =
          mode === "full-script"
            ? "正在提取全剧本资产…"
            : `正在提取第 ${episodeNumber ?? "-"} 集资产…`;
        if (previewExtractionIntervalRef.current !== null) {
          window.clearInterval(previewExtractionIntervalRef.current);
        }
        if (previewExtractionFinishRef.current !== null) {
          window.clearTimeout(previewExtractionFinishRef.current);
        }
        if (previewExtractionDoneRef.current !== null) {
          window.clearTimeout(previewExtractionDoneRef.current);
        }
        setPageNote(label);
        setExtractionBusy(true);
        setExtractionProgress({
          percent: 4,
          title: "正在提取资产",
          label,
        });
        previewExtractionIntervalRef.current = window.setInterval(() => {
          setExtractionProgress((previous) =>
            previous
              ? { ...previous, percent: Math.min(94, previous.percent + 7) }
              : previous,
          );
        }, 180);
        previewExtractionFinishRef.current = window.setTimeout(() => {
          if (previewExtractionIntervalRef.current !== null) {
            window.clearInterval(previewExtractionIntervalRef.current);
            previewExtractionIntervalRef.current = null;
          }
          setExtractionProgress({
            percent: 100,
            title: "提取完成",
            label: "资产列表正在更新…",
          });
          previewExtractionDoneRef.current = window.setTimeout(() => {
            setExtractionBusy(false);
            setExtractionProgress(null);
            setPageNote("提取完成，资产列表已更新。");
            previewExtractionDoneRef.current = null;
          }, 420);
          previewExtractionFinishRef.current = null;
        }, 2800);
      } else {
        const episodeNumber = extractionEpisodes.find(
          (episode) => episode.episodeId === episodeId,
        )?.episodeNumber;
        setExtractionProgress({
          percent: 3,
          title: "正在提取资产",
          label:
            mode === "full-script"
              ? "正在提取全剧本资产…"
              : `正在提取第 ${episodeNumber ?? "-"} 集资产…`,
        });
      }
      setExtractionRequest(
        mode === "full-script"
          ? { id: extractionRequestSeq.current, mode }
          : {
              id: extractionRequestSeq.current,
              mode,
              episodeId: episodeId ?? "",
            },
      );
    },
    [extractionEpisodes, previewMode],
  );

  const handleSavePage = useCallback(async () => {
    if (!editAllowed) {
      setPageNote("当前账号无资产编辑权限。");
      return;
    }
    setSaving(true);
    setPageNote("");
    try {
      await persist();
      setPageNote("已保存项目资产到服务器。");
    } catch (error) {
      setPageNote(
        error instanceof Error ? error.message : "保存失败，请稍后重试",
      );
    } finally {
      setSaving(false);
    }
  }, [editAllowed, persist]);

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
        <header
          className={`amw-head asset-library-toolbar${
            embedded ? " amw-head--embedded" : ""
          }`}
        >
          <div className="amw-head__titles">
            {isWorkspace && backHref ? (
              <p className="amw-head__back">
                <a className="amw-head__link" href={backHref}>
                  {backLabel}
                </a>
              </p>
            ) : null}
            <h1>资产管理</h1>
            <p>
              {projectName || "当前项目"}
              {loadError ? ` · ${loadError}` : ""}
              {!hydrated ? " · 加载中…" : ""}
            </p>
          </div>
          <div className="amw-head__actions">
            <span className="asset-collaboration-badge">
              <Users size={15} aria-hidden />
              {approvalEnabled ? "审批协作" : "所有人协作"}
            </span>
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
              className={`amw-btn amw-btn-primary amw-head__save ${saveBounce.bounceClass}`}
              disabled={!editAllowed || saving || pageLocked || !hydrated}
              onClick={() => {
                saveBounce.trigger();
                void handleSavePage();
              }}
              onAnimationEnd={saveBounce.onAnimationEnd}
            >
              <Save size={16} aria-hidden />
              {saving ? "保存中…" : "保存资产"}
            </button>
          </div>
          {pageNote ? <p className="amw-head__note">{pageNote}</p> : null}
        </header>

        <div className="asset-library-toolbar asset-library-toolbar--unified">
          <AssetTabs
            active={visibleTab}
            onChange={(tab) => {
              if (tab === "audio") return;
              setActiveTab(tab);
              setTabKey((k) => k + 1);
              setPageNote("");
            }}
          />
          <AssetExtractionToolbar
            model={extractionModel}
            onModelChange={setExtractionModel}
            onExtract={(mode) => {
              if (mode === "selected-episode") {
                setSelectedExtractionEpisodeId(
                  extractionEpisodes[0]?.episodeId ?? "",
                );
                setEpisodePickerOpen(true);
                return;
              }
              requestExtraction(mode);
            }}
            viewEpisodeOptions={viewEpisodeOptions}
            viewEpisodeValue={viewEpisodeValue}
            onViewEpisodeAssets={(episodeId) => {
              void viewEpisodeAssets(episodeId);
            }}
            extracting={pageLocked}
          />
        </div>

        <div
          className="asset-library-content"
          key={`${visibleTab}-${tabKey}-${viewEpisodeId ?? "all"}`}
        >
          <div className="asset-library-library-surface">
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

          {!previewMode ? (
            <EpisodeAssetDesignWorkspace
              projectId={projectId}
              headless
              showApprovalUi={approvalEnabled}
              approvalEnabled={approvalEnabled}
              submitApprovalRequestId={submitApprovalRequestId}
              extractionRequest={extractionRequest}
              extractionModel={extractionModel}
              onEpisodesChange={setExtractionEpisodes}
              onItemsChange={(nextItems, episodeId) => {
                setDesignItems(nextItems);
                setDesignEpisodeId(episodeId);
              }}
              onExtractionBusyChange={setExtractionBusy}
              onExtractionProgressChange={setExtractionProgress}
              onExtractionComplete={() => void refreshAssetDraft()}
            />
          ) : null}
        </div>
      </div>

      {pageLocked && extractionProgress ? (
        <div
          className="ead-page-lock asset-library-page__lock"
          role="region"
          aria-label={extractionProgress.title}
          data-testid="asset-extraction-page-lock"
        >
          <div className="ead-page-lock__panel">
            <strong>{extractionProgress.title}</strong>
            <div
              className="ead-page-lock__progress"
              role="progressbar"
              aria-label="资产提取总进度"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={extractionProgress.percent}
            >
              <span
                className="ead-page-lock__percentage"
                data-testid="asset-extraction-progress-percent"
              >
                {extractionProgress.percent}%
              </span>
              <span className="ead-page-lock__track" aria-hidden>
                <span style={{ width: `${extractionProgress.percent}%` }} />
              </span>
              <span className="ead-page-lock__progress-label">
                {extractionProgress.label}
              </span>
            </div>
          </div>
        </div>
      ) : null}

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
                  requestExtraction(
                    "selected-episode",
                    activeExtractionEpisodeId,
                  );
                  setEpisodePickerOpen(false);
                }}
              >
                开始提取
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}
