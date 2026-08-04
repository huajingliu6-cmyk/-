"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useChipBounce } from "@/shell/useChipBounce";
import type { ScriptEpisode } from "@/projects/script/types";
import {
  autoMatchStoryboardAssets,
  fetchEpisodeProduction,
  fetchStoryboardWorkspace,
  patchWorkspaceActiveEpisode,
  patchWorkingScript,
} from "@/projects/storyboard/api-client";
import type { PickerAsset } from "@/projects/storyboard/components/ProjectAssetPickerDialog";
import { EpisodeSidebar } from "@/projects/storyboard/components/EpisodeSidebar";
import { StoryboardProductionPanel } from "@/projects/storyboard/components/StoryboardProductionPanel";
import type {
  AssetsSummary,
  EpisodeProduction,
  ProjectStoryboardWorkspace,
} from "@/projects/storyboard/types";
import {
  projectManagementPath,
  workspaceProjectAssetsPath,
  workspaceProjectPath,
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

export function StoryboardCreationWorkspace({
  projectId,
  context = "management",
}: Props) {
  const saveBounce = useChipBounce();
  const isWorkspace = context === "workspace";

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

  const activeEpisodeId = workspace?.activeEpisodeId ?? null;
  const productions = workspace?.productions ?? [];
  const pickerAssets = useMemo(
    () => toPickerAssets(assetsSummary),
    [assetsSummary],
  );

  const loadProduction = useCallback(
    async (episodeId: string) => {
      let prod = await fetchEpisodeProduction(projectId, episodeId);
      // Existing storyboards: fill unresolved 人物/场景/道具 from the library.
      if (prod.activeStoryboard) {
        try {
          prod = await autoMatchStoryboardAssets(projectId, episodeId);
        } catch {
          // Non-blocking: keep loaded production if rematch fails.
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

      const activeId =
        data.workspace?.activeEpisodeId ?? data.episodes[0]?.id ?? null;
      if (activeId) {
        if (data.workspace && data.workspace.activeEpisodeId !== activeId) {
          const saved = await patchWorkspaceActiveEpisode(projectId, activeId);
          setWorkspace(saved);
        }
        await loadProduction(activeId);
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
    setProduction(updated);
    setScriptDraft(null);
    setWorkspace((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        productions: prev.productions.map((p) =>
          p.episodeId === updated.episodeId ? updated : p,
        ),
      };
    });
  }, []);

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

  const assetsHref = isWorkspace
    ? workspaceProjectAssetsPath(projectId)
    : `${projectManagementPath(projectId)}/assets`;
  const emptyBackHref = isWorkspace
    ? workspaceProjectPath(projectId)
    : `${projectManagementPath(projectId)}/script`;
  const emptyBackLabel = isWorkspace ? "返回工作台项目" : "返回剧本处理";

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
            </p>
          </div>
          <div className="sbw-head__actions">
            <Link href={assetsHref} className="sbw-link">
              返回资产管理
            </Link>
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
            />
          )}
        </div>
      </div>
    </div>
  );
}
