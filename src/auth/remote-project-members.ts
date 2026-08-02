import "server-only";

import type { ProjectMemberRecord } from "@/auth/roles";
import { requestRemoteData } from "@/persistence/remote-data-client";

type MembersResponse = { members: ProjectMemberRecord[] };
type MemberResponse = { member: ProjectMemberRecord };

async function memberRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await requestRemoteData(path, init);
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(
      payload?.error || `REMOTE_PROJECT_MEMBER_REQUEST_FAILED:${response.status}`,
    );
  }
  return (await response.json()) as T;
}

export async function listProjectMembersRemote(
  projectId: string,
): Promise<ProjectMemberRecord[]> {
  const result = await memberRequest<MembersResponse>(
    `/v1/project-members?projectId=${encodeURIComponent(projectId)}`,
  );
  return result.members;
}

export async function listMembershipsForUserRemote(
  userId: string,
): Promise<ProjectMemberRecord[]> {
  const result = await memberRequest<MembersResponse>(
    `/v1/project-members?userId=${encodeURIComponent(userId)}`,
  );
  return result.members;
}

export async function findProjectMemberRemote(
  projectId: string,
  userId: string,
): Promise<ProjectMemberRecord | null> {
  const members = await listProjectMembersRemote(projectId);
  return members.find((member) => member.userId === userId) ?? null;
}

export async function addCardEngineerRemote(input: {
  projectId: string;
  userId: string;
  createdBy: string;
}): Promise<ProjectMemberRecord> {
  const result = await memberRequest<MemberResponse>("/v1/project-members", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return result.member;
}

export async function removeCardEngineerRemote(
  projectId: string,
  userId: string,
): Promise<boolean> {
  const result = await memberRequest<{ removed: boolean }>(
    `/v1/project-members?projectId=${encodeURIComponent(projectId)}&userId=${encodeURIComponent(userId)}`,
    { method: "DELETE" },
  );
  return result.removed;
}