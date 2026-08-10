import "server-only";

import { getEnterpriseForProject } from "@/enterprise/store";

export function enterpriseCreditAccountId(enterpriseId: string): string {
  return `enterprise:${enterpriseId}`;
}

export async function resolveProjectCreditAccount(input: {
  projectId: string;
  actorUserId: string;
}): Promise<{
  accountId: string;
  actorUserId: string;
  enterpriseId?: string;
} | null> {
  const enterprise = await getEnterpriseForProject(input.projectId);
  if (!enterprise) {
    return { accountId: input.actorUserId, actorUserId: input.actorUserId };
  }
  if (!enterprise.members.some((member) => member.userId === input.actorUserId)) {
    return null;
  }
  return {
    accountId: enterpriseCreditAccountId(enterprise.id),
    actorUserId: input.actorUserId,
    enterpriseId: enterprise.id,
  };
}
