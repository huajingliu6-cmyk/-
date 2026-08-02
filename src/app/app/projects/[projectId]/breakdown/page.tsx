"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

/**
 * 旧「剧本分析 / 分镜」占位路由。
 * 流程已调整为：剧本 → 项目资产管理 → 分镜制作。
 * 访问时重定向到项目资产管理页。
 */
export default function ProjectScriptBreakdownRedirectPage() {
  const params = useParams<{ projectId: string }>();
  const router = useRouter();
  const projectId = params.projectId ?? "";

  useEffect(() => {
    if (!projectId) return;
    router.replace(
      `/app/projects/${encodeURIComponent(projectId)}/assets`,
    );
  }, [projectId, router]);

  return (
    <div className="mx-auto max-w-2xl px-6 py-16 text-[#f4f1ff]">
      <p className="text-sm text-white/50">正在进入项目资产管理…</p>
    </div>
  );
}
