"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ProjectAssetsShell } from "@/projects/assets/ProjectAssetsShell";
import type { AssetModuleId } from "@/projects/assets/AssetModuleNav";

type Props = {
  projectId: string;
  module: AssetModuleId;
  children: ReactNode;
};

export function ProjectAssetsManagementPage({
  projectId,
  module,
  children,
}: Props) {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}`,
        );
        if (!res.ok) {
          const payload = (await res.json()) as { error?: string };
          if (!cancelled) {
            setAllowed(false);
            setError(payload.error ?? "无权访问项目管理资产");
          }
          return;
        }
        if (!cancelled) setAllowed(true);
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
  }, [projectId]);

  if (!projectId) {
    return (
      <div className="amw">
        <p>缺少项目 ID</p>
      </div>
    );
  }

  if (allowed === null) {
    return (
      <ProjectAssetsShell projectId={projectId} module={module}>
        <p className="ead-muted">校验权限…</p>
      </ProjectAssetsShell>
    );
  }

  if (!allowed) {
    return (
      <ProjectAssetsShell projectId={projectId} module={module}>
        <p className="ead-error">{error}</p>
      </ProjectAssetsShell>
    );
  }

  return (
    <ProjectAssetsShell projectId={projectId} module={module}>
      {children}
    </ProjectAssetsShell>
  );
}
