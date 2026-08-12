import "server-only";

import {
  getEnterpriseForProject,
  listEnterprisesForUser,
} from "@/enterprise/store";
import type { Enterprise } from "@/enterprise/types";

/** Enterprise OWNER of the enterprise that lists this project. */
export async function getEnterpriseOwnedByUserForProject(
  userId: string,
  projectId: string,
): Promise<Enterprise | null> {
  const enterprise = await getEnterpriseForProject(projectId);
  if (!enterprise) return null;
  if (enterprise.ownerUserId !== userId) return null;
  if (!enterprise.projectIds.includes(projectId)) return null;
  return enterprise;
}

export async function userIsEnterpriseOwnerForProject(
  userId: string,
  projectId: string,
): Promise<boolean> {
  return Boolean(await getEnterpriseOwnedByUserForProject(userId, projectId));
}

export async function listProjectIdsOwnedViaEnterprise(
  userId: string,
): Promise<string[]> {
  const enterprises = await listEnterprisesForUser(userId);
  return [
    ...new Set(
      enterprises
        .filter((enterprise) => enterprise.ownerUserId === userId)
        .flatMap((enterprise) => enterprise.projectIds),
    ),
  ];
}
