import "server-only";

import { listUsers } from "@/auth/users";
import { listAssetApprovalsForAdmin } from "@/projects/assets/approvals/admin-list";
import { getProjectNameMap, listProjectRecords } from "@/projects/project-access";
import {
  getCreditBalance,
  getFrozenCredits,
  listCreditLedger,
} from "@/text-generation/credits";
import { enterpriseCreditAccountId } from "@/enterprise/credit-account";
import type { Enterprise } from "@/enterprise/types";
import {
  listEnterpriseAuditEvents,
  listEnterpriseJoinRequests,
} from "@/enterprise/store";

type EnterpriseDashboardVisibility = {
  approvals: boolean;
  audit: boolean;
  joinRequests: boolean;
};

export async function enterpriseDashboard(
  enterprise: Enterprise,
  visibility: EnterpriseDashboardVisibility,
) {
  const [users, projectNames, projects, requests, enterpriseEvents] = await Promise.all([
    listUsers(),
    getProjectNameMap(),
    listProjectRecords(),
    visibility.joinRequests
      ? listEnterpriseJoinRequests(enterprise.id)
      : Promise.resolve([]),
    visibility.audit
      ? listEnterpriseAuditEvents(enterprise.id)
      : Promise.resolve([]),
  ]);
  const userMap = new Map(users.map((user) => [user.id, user]));
  const projectIdSet = new Set(enterprise.projectIds);

  const approvalGroups = visibility.approvals
    ? await Promise.all(
        enterprise.projectIds.map((projectId) =>
          listAssetApprovalsForAdmin({ projectId, pageSize: 50 }),
        ),
      )
    : [];
  const approvals = approvalGroups
    .flatMap((group) => group.items)
    .sort((left, right) => right.submittedAt.localeCompare(left.submittedAt))
    .map((submission) => ({
      id: submission.id,
      projectId: submission.projectId,
      projectName: projectNames.get(submission.projectId) ?? submission.projectId,
      episodeId: submission.episodeId,
      status: submission.status,
      submitter: userMap.get(submission.submittedByUserId)?.displayName ?? "未知成员",
      approver: userMap.get(submission.approverUserId)?.displayName ?? "未知成员",
      itemCount: submission.items.length,
      submittedAt: submission.submittedAt,
      completedAt: submission.completedAt,
    }));

  const creditAccountId = enterpriseCreditAccountId(enterprise.id);
  const [enterpriseLedger, creditBalance, frozenCredits] = await Promise.all([
    visibility.audit ? listCreditLedger(creditAccountId) : Promise.resolve([]),
    visibility.audit ? getCreditBalance(creditAccountId) : Promise.resolve(0),
    visibility.audit ? getFrozenCredits(creditAccountId) : Promise.resolve(0),
  ]);
  const creditEvents = enterpriseLedger
    .filter((entry) => entry.projectId && projectIdSet.has(entry.projectId))
    .map((entry) => ({
          id: `credit:${entry.id}`,
          kind: "CREDIT" as const,
          actorUserId: entry.userId,
          actorName: userMap.get(entry.userId)?.displayName ?? entry.userId,
          projectId: entry.projectId ?? null,
          projectName: entry.projectId
            ? projectNames.get(entry.projectId) ?? entry.projectId
            : "—",
          delta: entry.delta,
          balanceAfter: entry.balanceAfter,
          reason: entry.reason,
          generationId: entry.generationId ?? null,
          summary:
            entry.delta < 0
              ? `消耗 ${Math.abs(entry.delta)} 积分`
              : `返还 ${entry.delta} 积分`,
          createdAt: entry.createdAt,
        }))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  const auditEvents = enterpriseEvents.map((event) => ({
    id: event.id,
    kind: "ENTERPRISE" as const,
    actorUserId: event.actorUserId,
    actorName: userMap.get(event.actorUserId)?.displayName ?? event.actorUserId,
    targetUserId: event.targetUserId,
    targetName: event.targetUserId
      ? userMap.get(event.targetUserId)?.displayName ?? event.targetUserId
      : null,
    projectId: event.projectId,
    projectName: event.projectId
      ? projectNames.get(event.projectId) ?? event.projectId
      : null,
    delta: null,
    balanceAfter: null,
    reason: event.type,
    generationId: null,
    summary: event.summary,
    createdAt: event.createdAt,
  }));

  return {
    enterprise: {
      id: enterprise.id,
      accountId: enterprise.accountId,
      name: enterprise.name,
      projectIds: enterprise.projectIds,
    },
    members: enterprise.members.map((member) => {
      const user = userMap.get(member.userId);
      return {
        ...member,
        username: user?.username ?? member.userId,
        displayName: user?.displayName ?? user?.username ?? member.userId,
      };
    }),
    projects: projects
      .filter((project) => projectIdSet.has(project.projectId))
      .map((project) => ({
        projectId: project.projectId,
        name: project.name,
        updatedAt: project.updatedAt,
      })),
    joinRequests: requests.map((request) => {
      const applicant = userMap.get(request.applicantUserId);
      return {
        ...request,
        applicantUsername: applicant?.username ?? request.applicantUserId,
        applicantDisplayName:
          applicant?.displayName ?? applicant?.username ?? request.applicantUserId,
      };
    }),
    approvals,
    auditEvents: [...creditEvents, ...auditEvents].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    ),
    stats: {
      memberCount: enterprise.members.length,
      projectCount: enterprise.projectIds.length,
      pendingJoinRequestCount: requests.filter((request) => request.status === "PENDING").length,
      pendingApprovalCount: approvals.filter(
        (approval) =>
          approval.status === "pending" || approval.status === "partially_approved",
      ).length,
      spentCredits: creditEvents.reduce(
        (sum, event) => sum + (event.delta < 0 ? Math.abs(event.delta) : 0),
        0,
      ),
      creditBalance,
      frozenCredits,
    },
  };
}
