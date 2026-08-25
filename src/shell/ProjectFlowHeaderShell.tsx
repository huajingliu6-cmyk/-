"use client";

import { createContext, useContext, useLayoutEffect, useState, type Dispatch, type SetStateAction } from "react";
import { usePathname } from "next/navigation";
import {
  ProjectFlowHeaderProvider,
  type ProjectFlowHeaderConfig,
} from "@/shell/project-flow-header-context";
import {
  isOneStackProjectStagePath,
  parseProjectFlowRoute,
} from "@/shell/nav";

type ProjectFlowHeaderSeed = {
  projectId: string;
  projectName: string;
  scriptHref: string;
  mode: "management" | "workspace";
};

const ProjectFlowHeaderSeedSetterContext = createContext<
  Dispatch<SetStateAction<ProjectFlowHeaderSeed | null>> | null
>(null);

type ShellProps = {
  children: React.ReactNode;
};

export function ProjectFlowHeaderShell({ children }: ShellProps) {
  const pathname = usePathname() ?? "";
  const route = parseProjectFlowRoute(pathname);
  const isStage = route !== null && isOneStackProjectStagePath(pathname);
  const [seed, setSeed] = useState<ProjectFlowHeaderSeed | null>(null);
  const [fetched, setFetched] = useState<{
    projectName: string;
    scriptHref: string;
  } | null>(null);

  useLayoutEffect(() => {
    if (!isStage || !route || route.mode !== "management") {
      setFetched(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(route.projectId)}`,
          { credentials: "include" },
        );
        if (!res.ok || cancelled) return;
        const payload = (await res.json()) as {
          project?: { name?: string; creationSource?: string | null };
        };
        if (cancelled || !payload.project) return;
        const base = `/app/projects/${encodeURIComponent(route.projectId)}`;
        setFetched({
          projectName: payload.project.name?.trim() || "未命名项目",
          scriptHref:
            payload.project.creationSource === "story"
              ? `${base}/story`
              : `${base}/script`,
        });
      } catch {
        if (!cancelled) {
          setFetched({
            projectName: "",
            scriptHref: `/app/projects/${encodeURIComponent(route.projectId)}/script`,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isStage, route?.mode, route?.projectId]);

  const seedMatches =
    seed !== null && route !== null && seed.projectId === route.projectId;

  const value: ProjectFlowHeaderConfig | null =
    isStage && route
      ? {
          projectId: route.projectId,
          mode: route.mode,
          scriptHref:
            (seedMatches ? seed.scriptHref : undefined) ??
            fetched?.scriptHref ??
            `/app/projects/${encodeURIComponent(route.projectId)}/script`,
          projectName:
            (seedMatches ? seed.projectName : null) ??
            fetched?.projectName ??
            null,
        }
      : null;

  return (
    <ProjectFlowHeaderSeedSetterContext.Provider value={setSeed}>
      <ProjectFlowHeaderProvider value={value}>{children}</ProjectFlowHeaderProvider>
    </ProjectFlowHeaderSeedSetterContext.Provider>
  );
}

type SeedProps = {
  projectId: string;
  projectName: string;
  scriptHref: string;
  mode: "management" | "workspace";
};

export function ProjectFlowHeaderSeed({
  projectId,
  projectName,
  scriptHref,
  mode,
}: SeedProps) {
  const pathname = usePathname() ?? "";
  const setSeed = useContext(ProjectFlowHeaderSeedSetterContext);

  useLayoutEffect(() => {
    if (!setSeed) return;
    if (!isOneStackProjectStagePath(pathname)) {
      setSeed(null);
      return;
    }
    setSeed({
      projectId,
      projectName: projectName.trim() || "未命名项目",
      scriptHref,
      mode,
    });
    return () => setSeed(null);
  }, [mode, pathname, projectId, projectName, scriptHref, setSeed]);

  return null;
}
