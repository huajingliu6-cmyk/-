import { NextResponse } from "next/server";
import { requireEnterpriseAccess } from "@/enterprise/access";
import { enterpriseDashboard } from "@/enterprise/dashboard";
import { hasEnterprisePermission } from "@/enterprise/permissions";

type RouteContext = { params: Promise<{ enterpriseId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { enterpriseId } = await context.params;
  const access = await requireEnterpriseAccess(enterpriseId);
  if (!access.ok) return access.response;
  const canAudit = hasEnterprisePermission(access.member, "audit.read");
  const canReadApprovals = hasEnterprisePermission(
    access.member,
    "approvals.read",
  );
  const canReviewRequests = hasEnterprisePermission(
    access.member,
    "join_requests.review",
  );
  const canAssignProjects = hasEnterprisePermission(
    access.member,
    "projects.assign",
  );
  const canManageJobs = hasEnterprisePermission(
    access.member,
    "members.manage_jobs",
  );
  const canManageAdmins = hasEnterprisePermission(
    access.member,
    "members.manage_admins",
  );
  const canRemoveMembers = hasEnterprisePermission(
    access.member,
    "members.remove",
  );
  const dashboard = await enterpriseDashboard(access.enterprise, {
    approvals: canReadApprovals,
    audit: canAudit,
    joinRequests: canReviewRequests,
  });
  return NextResponse.json({
    ...dashboard,
    currentMember: access.member,
    permissions: {
      canAssignProjects,
      canAudit,
      canManageAdmins,
      canManageJobs,
      canReadApprovals,
      canRemoveMembers,
      canReviewRequests,
    },
  });
}
