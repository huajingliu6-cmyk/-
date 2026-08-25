"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { parseResponseJson } from "@/projects/assets/parse-response-json";
import { readCurrentProjectId, writeCurrentProjectId } from "@/shell/current-project-context";
import { APP_INFINITE_CANVAS_PATH } from "@/shell/nav";

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

async function readProjectMode(
  projectId: string,
): Promise<"canvas" | "full-stack" | null> {
  try {
    const response = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}`,
      { credentials: "include" },
    );
    const data = await parseResponseJson<{
      project?: { projectMode?: string };
    }>(response, { allowEmpty: true });
    if (!response.ok) return null;
    return data.project?.projectMode === "canvas" ? "canvas" : "full-stack";
  } catch {
    return null;
  }
}

export function useOpenCanvas() {
  const router = useRouter();

  const openCanvas = useCallback(async () => {
    const currentId = readCurrentProjectId("canvas");
    if (currentId) {
      const mode = await readProjectMode(currentId);
      if (mode === "canvas") {
        const path = await resolveProjectEntryPath(currentId);
        if (path) {
          writeCurrentProjectId(currentId, "canvas");
          router.push(path);
          return;
        }
      }
    }

    router.push(APP_INFINITE_CANVAS_PATH);
  }, [router]);

  return { openCanvas };
}

export async function checkVideoCanvasAccess(projectId: string): Promise<boolean> {
  try {
    const response = await fetch(
      `/api/workspace/projects/${encodeURIComponent(projectId)}/video-access`,
      { credentials: "include" },
    );
    if (!response.ok) {
      await parseResponseJson(response, { allowEmpty: true });
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
