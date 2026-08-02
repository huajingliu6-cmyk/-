"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { projectManagementPath } from "@/shell/nav";

export default function ProjectAssetsRedirectPage() {
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
          `/api/projects/${encodeURIComponent(projectId)}`,
        );
        if (!res.ok) {
          const payload = (await res.json()) as { error?: string };
          if (!cancelled) {
            setError(payload.error ?? "无权访问项目管理资产");
          }
          return;
        }
        if (!cancelled) {
          router.replace(
            `${projectManagementPath(projectId)}/assets/design`,
          );
        }
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
      <p>正在进入资产设计确认…</p>
    </div>
  );
}
