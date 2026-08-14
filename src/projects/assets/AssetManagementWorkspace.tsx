"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useChipBounce } from "@/shell/useChipBounce";
import { AssetTabs } from "@/projects/assets/AssetTabs";
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

  useEffect(() => {
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
                  project?: { name?: string };
                };
                setProjectName(data.project?.name ?? "");
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
          project?: { name?: string };
          draft?: ProjectAssetBundle | null;
          canEdit?: boolean;
        };
        if (cancelled) return;
        setProjectName(data.project?.name ?? "");
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
  }, [isWorkspace, projectId]);

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
    >
      <div
        className={
          embedded
            ? "amw-library-workspace__inner asset-library-page__inner"
            : "amw-inner asset-library-page__inner"
        }
      >
        <header
          className={`amw-head asset-library-toolbar${
            embedded ? " amw-head--embedded" : ""
          }`}
        >
          {!embedded ? (
            <div className="amw-head__titles">
              {isWorkspace && backHref ? (
                <p className="amw-head__back">
                  <a className="amw-head__link" href={backHref}>
                    {backLabel}
                  </a>
                </p>
              ) : null}
              <h1>项目资产管理</h1>
              <p>
                管理视频制作所需的角色、场景和道具资产。
                {projectName ? ` · ${projectName}` : ""}
                {loadError ? ` · ${loadError}` : ""}
                {!hydrated ? " · 加载中…" : ""}
              </p>
            </div>
          ) : (
            <div className="amw-head__titles amw-head__titles--compact">
              {projectName ? (
                <p className="ead-muted">{projectName}</p>
              ) : null}
              {loadError ? <p className="ead-error">{loadError}</p> : null}
              {!hydrated ? <p className="ead-muted">加载中…</p> : null}
            </div>
          )}
          <div className="amw-head__actions">
            <button
              type="button"
              className={`amw-btn amw-btn-primary amw-head__save ${saveBounce.bounceClass}`}
              disabled={!editAllowed || saving || !hydrated}
              onClick={() => {
                saveBounce.trigger();
                void handleSavePage();
              }}
              onAnimationEnd={saveBounce.onAnimationEnd}
            >
              {saving ? "保存中…" : "保存页面"}
            </button>
          </div>
          {pageNote ? <p className="amw-head__note">{pageNote}</p> : null}
        </header>

        <div className="asset-library-toolbar">
          <AssetTabs
            active={visibleTab}
            onChange={(tab) => {
              if (tab === "audio") return;
              setActiveTab(tab);
              setTabKey((k) => k + 1);
              setPageNote("");
            }}
          />
        </div>

        <div
          className="asset-library-content"
          key={`${visibleTab}-${tabKey}`}
        >
          {visibleTab === "character" ? (
            <CharacterManager
              projectId={projectId}
              characters={characters}
              audios={audios}
              canEdit={editAllowed}
              onChange={setCharacters}
              onPersist={async (nextCharacters) => {
                setCharacters(nextCharacters);
                await persist({ characters: nextCharacters });
              }}
            />
          ) : null}
          {visibleTab === "scene" ? (
            <SceneManager
              projectId={projectId}
              scenes={scenes}
              canEdit={editAllowed}
              onChange={setScenes}
              onPersist={async (nextScenes) => {
                setScenes(nextScenes);
                await persist({ scenes: nextScenes });
              }}
            />
          ) : null}
          {visibleTab === "prop" ? (
            <PropManager
              projectId={projectId}
              props={props}
              canEdit={editAllowed}
              onChange={setProps}
              onPersist={async (nextProps) => {
                setProps(nextProps);
                await persist({ props: nextProps });
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
