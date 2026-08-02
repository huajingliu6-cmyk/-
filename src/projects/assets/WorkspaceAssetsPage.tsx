"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ProjectAssetsShell } from "@/projects/assets/ProjectAssetsShell";
import type { AssetModuleId } from "@/projects/assets/AssetModuleNav";

type Props = {
  projectId: string;
  module: AssetModuleId;
  children: ReactNode;
  /** 是否显示设计确认导航；默认由 effectiveRole 推断 */
  showDesign?: boolean;
};

/**
 * 工作台资产壳：校验 workspace 项目访问；按角色决定是否展示设计模块。
 */
export function WorkspaceAssetsPage({
  projectId,
  module,
  children,
  showDesign: showDesignProp,
}: Props) {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [showDesign, setShowDesign] = useState(showDesignProp ?? true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/workspace/projects/${encodeURIComponent(projectId)}`,
        );
        if (!res.ok) {
          const payload = (await res.json()) as { error?: string };
          if (!cancelled) {
            setAllowed(false);
            setError(payload.error ?? "无权访问工作台资产");
          }
          return;
        }
        await res.json();
        if (!cancelled) {
          setAllowed(true);
          if (showDesignProp === undefined) {
            setShowDesign(true);
          }
        }
      } catch {
        if (!cancelled) {
          setAllowed(false);
          setError("无法校验权限");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, showDesignProp]);

  if (!projectId) {
    return (
      <div className="amw">
        <p>缺少项目 ID</p>
      </div>
    );
  }

  const designVisible = showDesignProp ?? showDesign;

  if (allowed === null) {
    return (
      <ProjectAssetsShell
        projectId={projectId}
        module={module}
        context="workspace"
        showDesign={designVisible}
      >
        <p className="ead-muted">校验权限…</p>
      </ProjectAssetsShell>
    );
  }

  if (!allowed) {
    return (
      <ProjectAssetsShell
        projectId={projectId}
        module={module}
        context="workspace"
        showDesign={designVisible}
      >
        <p className="ead-error">{error}</p>
      </ProjectAssetsShell>
    );
  }

  return (
    <ProjectAssetsShell
      projectId={projectId}
      module={module}
      context="workspace"
      showDesign={designVisible}
    >
      {children}
    </ProjectAssetsShell>
  );
}
