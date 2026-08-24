"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { parseResponseJson } from "@/projects/assets/parse-response-json";
import { readCurrentProjectId, writeCurrentProjectId } from "@/shell/current-project-context";
import { APP_PROJECTS_PATH } from "@/shell/nav";

async function resolveProjectEntryPath(projectId: string): Promise<string | null> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/entry`,
    { credentials: "include" },
  );
  const data = await parseResponseJson<{ path?: string; error?: string }>(response, {
    allowEmpty: true,
  });
  if (!response.ok) return null;
  return data.path?.trim() || null;
}

export function useOpenOneStackFlow() {
  const router = useRouter();

  const openOneStackFlow = useCallback(async () => {
    const currentId = readCurrentProjectId();
    if (!currentId) {
      router.push(APP_PROJECTS_PATH);
      return;
    }

    try {
      const path = await resolveProjectEntryPath(currentId);
      if (path) {
        writeCurrentProjectId(currentId);
        router.push(path);
        return;
      }
    } catch {
      /* fall through */
    }

    router.push(`${APP_PROJECTS_PATH}?denied=one-stack-flow`);
  }, [router]);

  return { openOneStackFlow };
}
