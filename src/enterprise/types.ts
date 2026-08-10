export type EnterpriseMemberRole = "OWNER" | "ADMIN" | "MEMBER";

export type EnterpriseJobRole =
  | "PRODUCER"
  | "DIRECTOR"
  | "WRITER"
  | "ART_DESIGNER"
  | "STORYBOARD_ARTIST"
  | "CARD_ENGINEER"
  | "POST_PRODUCTION";

export type EnterpriseMember = {
  userId: string;
  enterpriseRole: EnterpriseMemberRole;
  jobRole: EnterpriseJobRole;
  joinedAt: string;
  invitedByUserId: string | null;
};

export type Enterprise = {
  id: string;
  accountId: string;
  name: string;
  ownerUserId: string;
  members: EnterpriseMember[];
  /** Only explicitly attached projects belong to the enterprise. */
  projectIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type EnterpriseJoinRequestStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED";

export type EnterpriseJoinRequest = {
  id: string;
  enterpriseId: string;
  applicantUserId: string;
  status: EnterpriseJoinRequestStatus;
  message: string;
  createdAt: string;
  decidedAt: string | null;
  decidedByUserId: string | null;
};

export type EnterpriseAuditEventType =
  | "ENTERPRISE_CREATED"
  | "JOIN_REQUEST_SUBMITTED"
  | "JOIN_REQUEST_APPROVED"
  | "JOIN_REQUEST_REJECTED"
  | "MEMBER_JOB_ROLE_CHANGED"
  | "MEMBER_ENTERPRISE_ROLE_CHANGED"
  | "MEMBER_REMOVED"
  | "MEMBER_INVITED"
  | "MEMBER_LEFT"
  | "OWNERSHIP_TRANSFERRED"
  | "ENTERPRISE_DISSOLVED"
  | "PROJECTS_ASSIGNED";

export type EnterpriseAuditEvent = {
  id: string;
  enterpriseId: string;
  type: EnterpriseAuditEventType;
  actorUserId: string;
  targetUserId: string | null;
  projectId: string | null;
  summary: string;
  createdAt: string;
};

export type EnterpriseCatalog = {
  version: 1;
  enterprises: Enterprise[];
  joinRequests: EnterpriseJoinRequest[];
  auditEvents: EnterpriseAuditEvent[];
};
