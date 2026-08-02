"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { workspaceProjectAssetsDesignPath } from "@/shell/nav";

/** 工作台 /assets：有资产权限者（含 CE）进入设计确认 */
export default function WorkspaceProjectAssetsRedirectPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const router = useRouter();
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
            setError(payload.error ?? "无权访问工作台资产");
          }
          return;
        }
        if (cancelled) return;
        router.replace(workspaceProjectAssetsDesignPath(projectId));
      } catch {
        if (!cancelled) setError("无法校验权限");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, router]);

  if (!projectId) {
    return (
      <div className="amw">
        <p>缺少项目 ID</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="amw">
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="amw">
      <p>正在进入项目资产…</p>
    </div>
  );
}
