"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useChipBounce } from "@/shell/useChipBounce";
import { safeRandomUUID } from "@/lib/safe-random-id";
import type { ScriptEpisode } from "@/projects/script/types";
import {
  autoMatchStoryboardAssets,
  fetchEpisodeProduction,
  fetchStoryboardWorkspace,
  generateStoryboard,
  patchStoryboardWorkspace,
  patchWorkspaceActiveEpisode,
  patchWorkingScript,
  StoryboardGenerateInProgressError,
} from "@/projects/storyboard/api-client";
import { storyboardNeedsLibraryRematch } from "@/projects/storyboard/services/shot-library-match";
import type { PickerAsset } from "@/projects/storyboard/components/ProjectAssetPickerDialog";
import { EpisodeSidebar } from "@/projects/storyboard/components/EpisodeSidebar";
import { StoryboardGlobalSettingsDialog } from "@/projects/storyboard/components/StoryboardGlobalSettingsDialog";
import { StoryboardProductionPanel } from "@/projects/storyboard/components/StoryboardProductionPanel";
import type {
  AssetsSummary,
  EpisodeProduction,
  ProjectStoryboardWorkspace,
} from "@/projects/storyboard/types";
import type { StoryboardVideoDefaults } from "@/projects/storyboard/storyboard-video-params";
import {
  getPromptGenerationServerSnapshot,
  getPromptGenerationSnapshot,
  requestEpisodePromptGeneration,
  resolveEpisodePromptGenDisplayStatus,
  STORYBOARD_PROMPT_GEN_MAX_CONCURRENT,
  subscribePromptGeneration,
  syncPromptGenerationFromProduction,
} from "@/projects/storyboard/prompt-generation-manager";
import {
  APP_WORKBENCH_PATH,
  projectManagementPath,
} from "@/shell/nav";
import { RouteLoadingOverlay } from "@/shell/RouteLoadingOverlay";
import "@/projects/storyboard/storyboard-workspace.css";

type Props = {
  projectId: string;
  /** management：项目管理分镜；workspace：工作台分镜（链接留在工作台下） */
  context?: "management" | "workspace";
};

function toPickerAssets(summary: AssetsSummary | null): PickerAsset[] {
  if (!summary) return [];
  return [
    ...summary.characters.map((a) => ({
      id: a.id,
      name: a.name,
      kind: "character" as const,
      thumbUrl: a.thumbUrl,
      ...(a.mediaOptions?.length ? { mediaOptions: a.mediaOptions } : {}),
      voiceBound: a.voiceBound === true,
      videoRefSafetyStatus: a.videoRefSafetyStatus ?? null,
    })),
    ...summary.props.map((a) => ({
      id: a.id,
      name: a.name,
      kind: "prop" as const,
      thumbUrl: a.thumbUrl,
      ...(a.mediaOptions?.length ? { mediaOptions: a.mediaOptions } : {}),
      videoRefSafetyStatus: a.videoRefSafetyStatus ?? null,
    })),
    ...summary.scenes.map((a) => ({
      id: a.id,
      name: a.name,
      kind: "scene" as const,
      thumbUrl: a.thumbUrl,
      ...(a.mediaOptions?.length ? { mediaOptions: a.mediaOptions } : {}),
      videoRefSafetyStatus: a.videoRefSafetyStatus ?? null,
    })),
  ];
}

async function waitForEpisodePromptSettled(
  projectId: string,
  episodeId: string,
  onProductionChange: (p: EpisodeProduction) => void,
): Promise<EpisodeProduction> {
  const started = Date.now();
  const maxMs = 12 * 60 * 1000;
  while (Date.now() - started < maxMs) {
    const latest = await fetchEpisodeProduction(projectId, episodeId);
    onProductionChange(latest);
    if (latest.status !== "storyboard_generating") {
      if (latest.status === "generation_failed") {
        throw new Error(latest.generationError || "分镜提示词生成失败");
      }
      return latest;
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error("分镜提示词生成超时，请稍后刷新查看");
}

export function StoryboardCreationWorkspace({
  projectId,
  context = "management",
}: Props) {
  const saveBounce = useChipBounce();
  const isWorkspace = context === "workspace";
  const promptSnap = useSyncExternalStore(
    subscribePromptGeneration,
    () => getPromptGenerationSnapshot(projectId),
    getPromptGenerationServerSnapshot,
  );

  const [projectName, setProjectName] = useState("");
  const [episodes, setEpisodes] = useState<ScriptEpisode[]>([]);
  const [workspace, setWorkspace] = useState<ProjectStoryboardWorkspace | null>(
    null,
  );
  const [assetsSummary, setAssetsSummary] = useState<AssetsSummary | null>(null);
  const [production, setProduction] = useState<EpisodeProduction | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saveNote, setSaveNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [switchingEpisode, setSwitchingEpisode] = useState(false);
  const [scriptDraft, setScriptDraft] = useState<string | null>(null);
  const [globalSettingsOpen, setGlobalSettingsOpen] = useState(false);
  const [savingGlobalSettings, setSavingGlobalSettings] = useState(false);

  const activeEpisodeId = workspace?.activeEpisodeId ?? null;
  const productions = workspace?.productions ?? [];
  const pickerAssets = useMemo(
    () => toPickerAssets(assetsSummary),
    [assetsSummary],
  );

  const promptQueueHint =
    promptSnap.generatingCount > 0 || promptSnap.queuedCount > 0
      ? `（生成中 ${promptSnap.generatingCount}/${STORYBOARD_PROMPT_GEN_MAX_CONCURRENT}，等待 ${promptSnap.queuedCount}）`
      : "";

  const loadProduction = useCallback(
    async (episodeId: string, opts?: { prefer?: EpisodeProduction | null }) => {
      let prod =
        opts?.prefer && opts.prefer.episodeId === episodeId
          ? opts.prefer
          : await fetchEpisodeProduction(projectId, episodeId);

      syncPromptGenerationFromProduction({
        projectId,
        episodeId,
        productionStatus: prod.status,
        generationError: prod.generationError,
      });

      if (
        prod.activeStoryboard &&
        prod.status !== "storyboard_generating" &&
        storyboardNeedsLibraryRematch(prod.activeStoryboard)
      ) {
        try {
          if (opts?.prefer && opts.prefer.episodeId === episodeId) {
            prod = await fetchEpisodeProduction(projectId, episodeId);
          }
          if (
            prod.activeStoryboard &&
            prod.status !== "storyboard_generating" &&
            storyboardNeedsLibraryRematch(prod.activeStoryboard)
          ) {
            prod = await autoMatchStoryboardAssets(projectId, episodeId);
          }
        } catch {
          // Non-blocking
        }
      } else if (opts?.prefer && opts.prefer.episodeId === episodeId) {
        try {
          prod = await fetchEpisodeProduction(projectId, episodeId);
        } catch {
          // Keep workspace-cached production if refresh fails.
        }
      }
      setProduction(prod);
      setScriptDraft(null);
      return prod;
    },
    [projectId],
  );

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchStoryboardWorkspace(projectId);
      setProjectName(data.project?.name ?? "");
      setEpisodes(data.episodes);
      setWorkspace(data.workspace);
      setAssetsSummary(data.assetsSummary);

      for (const prod of data.workspace?.productions ?? []) {
        syncPromptGenerationFromProduction({
          projectId,
          episodeId: prod.episodeId,
          productionStatus: prod.status,
          generationError: prod.generationError,
        });
      }

      const activeId =
        data.workspace?.activeEpisodeId ?? data.episodes[0]?.id ?? null;
      if (activeId) {
        if (data.workspace && data.workspace.activeEpisodeId !== activeId) {
          const saved = await patchWorkspaceActiveEpisode(projectId, activeId);
          setWorkspace(saved);
        }
        const fromWorkspace =
          data.workspace?.productions.find((p) => p.episodeId === activeId) ??
          null;
        if (fromWorkspace) {
          setProduction(fromWorkspace);
          setLoading(false);
        }
        await loadProduction(activeId, { prefer: fromWorkspace });
      } else {
        setProduction(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [loadProduction, projectId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await loadAll();
      } catch {
        if (!cancelled) setError("无法加载分镜工作台");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadAll]);

  const handleProductionChange = useCallback((updated: EpisodeProduction) => {
    setProduction((prev) =>
      prev && prev.episodeId === updated.episodeId ? updated : prev,
    );
    setScriptDraft(null);
    setWorkspace((ws) => {
      if (!ws) return ws;
      return {
        ...ws,
        productions: ws.productions.map((p) =>
          p.episodeId === updated.episodeId ? updated : p,
        ),
      };
    });
    syncPromptGenerationFromProduction({
      projectId,
      episodeId: updated.episodeId,
      productionStatus: updated.status,
      generationError: updated.generationError,
    });
  }, [projectId]);

  const handleRequestPromptGenerate = useCallback(
    (episodeId: string, opts?: { force?: boolean }) => {
      const result = requestEpisodePromptGeneration({
        projectId,
        episodeId,
        run: async () => {
          const key = safeRandomUUID();
          try {
            const updated = await generateStoryboard(projectId, episodeId, key);
            handleProductionChange(updated);
            if (updated.status === "generation_failed") {
              throw new Error(
                updated.generationError || "分镜提示词生成失败",
              );
            }
            if (
              updated.generationError?.includes("已生成") &&
              updated.generationError.includes("未匹配")
            ) {
              setSaveNote(updated.generationError);
            }
            if (updated.status === "storyboard_generating") {
              await waitForEpisodePromptSettled(
                projectId,
                episodeId,
                handleProductionChange,
              );
            }
          } catch (error) {
            if (error instanceof StoryboardGenerateInProgressError) {
              handleProductionChange(error.production);
              await waitForEpisodePromptSettled(
                projectId,
                episodeId,
                handleProductionChange,
              );
              return;
            }
            throw error;
          }
        },
      });
      void opts;
      if (result.message) {
        setSaveNote(result.message);
      } else if (result.queued) {
        setSaveNote(
          `已进入等待队列（生成中 ${result.generatingCount}，等待 ${result.queuedCount}）`,
        );
      } else if (result.accepted) {
        setSaveNote("正在生成整集分镜提示词…");
      }
    },
    [handleProductionChange, projectId],
  );

  const handleSelectEpisode = useCallback(
    async (episodeId: string) => {
      if (episodeId === activeEpisodeId) return;
      setSwitchingEpisode(true);
      setSaveNote("");
      try {
        const saved = await patchWorkspaceActiveEpisode(projectId, episodeId);
        setWorkspace(saved);
        await loadProduction(episodeId);
      } catch (err) {
        setSaveNote(err instanceof Error ? err.message : "切换剧集失败");
      } finally {
        setSwitchingEpisode(false);
      }
    },
    [activeEpisodeId, loadProduction, projectId],
  );

  const handleSaveDraft = useCallback(async () => {
    if (!production || !activeEpisodeId) return;
    setSaving(true);
    setSaveNote("");
    try {
      let updated = production;
      const scriptToSave = scriptDraft ?? production.workingScriptText;
      if (scriptToSave.trim()) {
        updated = await patchWorkingScript(
          projectId,
          production.episodeId,
          scriptToSave,
        );
        handleProductionChange(updated);
        setScriptDraft(null);
      }
      const savedWorkspace = await patchWorkspaceActiveEpisode(
        projectId,
        activeEpisodeId,
      );
      setWorkspace(savedWorkspace);
      setSaveNote("草稿已保存。");
    } catch (err) {
      setSaveNote(err instanceof Error ? err.message : "保存失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }, [
    activeEpisodeId,
    handleProductionChange,
    production,
    projectId,
    scriptDraft,
  ]);

  const handleSaveGlobalSettings = useCallback(
    async (next: StoryboardVideoDefaults) => {
      setSavingGlobalSettings(true);
      setSaveNote("");
      try {
        const saved = await patchStoryboardWorkspace(projectId, {
          videoDefaults: next,
          ...(activeEpisodeId ? { activeEpisodeId } : {}),
        });
        setWorkspace(saved);
        setGlobalSettingsOpen(false);
        setSaveNote("全局设置已保存。");
      } catch (err) {
        setSaveNote(
          err instanceof Error ? err.message : "保存全局设置失败，请稍后重试",
        );
      } finally {
        setSavingGlobalSettings(false);
      }
    },
    [activeEpisodeId, projectId],
  );

  const emptyBackHref = isWorkspace
    ? APP_WORKBENCH_PATH
    : `${projectManagementPath(projectId)}/script`;
  const emptyBackLabel = isWorkspace ? "返回工作台" : "返回剧本处理";

  const activePromptStatus = production
    ? resolveEpisodePromptGenDisplayStatus({
        productionStatus: production.status,
        hasStoryboard: Boolean(production.activeStoryboard),
        job: promptSnap.jobs[production.episodeId],
      })
    : "idle";

  if (loading) {
    return (
      <div className="sbw">
        <RouteLoadingOverlay
          title="正在进入分镜创作"
          description={
            isWorkspace
              ? "正在准备工作台分镜创作区域，请稍候"
              : "正在准备分镜创作工作区，请稍候"
          }
        />
      </div>
    );
  }

  if (error && episodes.length === 0) {
    return (
      <div className="sbw">
        <div className="sbw-inner">
          <div className="sbw-empty">
            <p>{error}</p>
            <Link href={emptyBackHref} className="sbw-link" style={{ marginTop: 12 }}>
              {emptyBackLabel}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (episodes.length === 0) {
    return (
      <div className="sbw">
        <div className="sbw-inner">
          <header className="sbw-head">
            <div className="sbw-head__titles">
              <h1>分镜创作</h1>
              <p>
                {projectName ? `${projectName} · ` : ""}
                尚未创建分集
              </p>
            </div>
          </header>
          <div className="sbw-empty">
            <p>请先在剧本工作台完成分集，再进入分镜创作。</p>
            <Link href={emptyBackHref} className="sbw-link" style={{ marginTop: 12 }}>
              {emptyBackLabel}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="sbw">
      <div className="sbw-inner">
        <header className="sbw-head">
          <div className="sbw-head__titles">
            <h1>分镜创作</h1>
            <p>
              确认本集剧本后生成分镜提示词。
              {projectName ? ` · ${projectName}` : ""}
              {error ? ` · ${error}` : ""}
              {promptQueueHint ? ` · ${promptQueueHint}` : ""}
            </p>
          </div>
          <div className="sbw-head__actions">
            <button
              type="button"
              className="sbw-link"
              data-testid="storyboard-global-settings-btn"
              onClick={() => setGlobalSettingsOpen(true)}
            >
              全局设置
            </button>
            <button
              type="button"
              className={`sbw-btn sbw-btn-primary sbw-head__save ${saveBounce.bounceClass}`}
              disabled={saving || !production}
              onClick={() => {
                saveBounce.trigger();
                void handleSaveDraft();
              }}
              onAnimationEnd={saveBounce.onAnimationEnd}
            >
              {saving ? "保存中…" : "保存页面"}
            </button>
          </div>
          {saveNote ? <p className="sbw-head__note">{saveNote}</p> : null}
        </header>

        <div className="sbw-layout">
          <EpisodeSidebar
            episodes={episodes}
            productions={productions}
            activeEpisodeId={activeEpisodeId}
            switching={switchingEpisode}
            promptJobs={promptSnap.jobs}
            onSelect={(id) => void handleSelectEpisode(id)}
          />

          {!production ? (
            <div className="sbw-panel">
              <div className="sbw-empty">请选择剧集</div>
            </div>
          ) : (
            <StoryboardProductionPanel
              key={production.episodeId}
              projectId={projectId}
              production={production}
              assets={pickerAssets}
              onProductionChange={handleProductionChange}
              onNote={setSaveNote}
              onScriptDraftChange={setScriptDraft}
              videoDefaults={workspace?.videoDefaults}
              promptGenStatus={activePromptStatus}
              promptGenError={
                promptSnap.jobs[production.episodeId]?.error ||
                production.generationError ||
                undefined
              }
              promptQueueHint={promptQueueHint}
              onRequestPromptGenerate={(opts) =>
                handleRequestPromptGenerate(production.episodeId, opts)
              }
            />
          )}
        </div>
      </div>

      <StoryboardGlobalSettingsDialog
        open={globalSettingsOpen}
        initial={workspace?.videoDefaults}
        saving={savingGlobalSettings}
        onClose={() => setGlobalSettingsOpen(false)}
        onSave={handleSaveGlobalSettings}
      />
    </div>
  );
}
