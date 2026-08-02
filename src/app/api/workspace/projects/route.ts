import { NextResponse } from "next/server";
import { requireSessionUser } from "@/auth/require-user";
import { getSystemRole, workspaceFeaturesForRole } from "@/auth/roles";
import {
  listAccessibleWorkspaceProjectIds,
  resolveEffectiveProjectRole,
  userOwnsAnyProject,
} from "@/auth/effective-role";
import { listProjectRecords } from "@/projects/project-access";
import { loadAssetBundleDraft } from "@/projects/assets/asset-bundle-store";

function assetCounts(
  draft: Awaited<ReturnType<typeof loadAssetBundleDraft>>,
) {
  if (!draft) {
    return { characters: 0, scenes: 0, props: 0, audios: 0, total: 0 };
  }
  return {
    characters: draft.characters.length,
    scenes: draft.scenes.length,
    props: draft.props.length,
    audios: draft.audios.length,
    total:
      draft.characters.length +
      draft.scenes.length +
      draft.props.length +
      draft.audios.length,
  };
}

/** GET：工作台项目列表（按角色过滤） */
export async function GET() {
  const session = await requireSessionUser();
  if (!session.ok) return session.response;

  const user = session.user;
  const systemRole = getSystemRole(user);
  const ownsAny = await userOwnsAnyProject(user.id);
  const allowedIds = await listAccessibleWorkspaceProjectIds(user);
  const allowedSet = new Set(allowedIds);
  const all = await listProjectRecords();
  const projects = [];

  for (const record of all) {
    if (!allowedSet.has(record.projectId)) continue;
    const role = await resolveEffectiveProjectRole(
      user.id,
      record.projectId,
      user,
    );
    if (role === "NONE") continue;
    const draft = await loadAssetBundleDraft(record.projectId);
    projects.push({
      projectId: record.projectId,
      projectName: record.name,
      updatedAt: record.updatedAt,
      projectStatus: record.status,
      effectiveRole: role,
      creationSource: record.creationSource,
      projectMode: record.projectMode,
      assetSummary: assetCounts(draft),
      workspaceFeatures: workspaceFeaturesForRole(role),
    });
  }

  projects.sort(
    (a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );

  const emptyMessage =
    projects.length > 0
      ? null
      : systemRole === "SYSTEM_ADMIN" || ownsAny
        ? "当前没有可在工作台中继续处理的项目。"
        : "当前没有已分配的项目，请联系系统管理员或项目主理人为你分配项目。";

  return NextResponse.json({
    projects,
    systemRole,
    emptyMessage,
  });
}
