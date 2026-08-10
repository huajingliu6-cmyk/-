import "server-only";

import { randomBytes, randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { isRemoteDataOnly } from "@/persistence/remote-data-client";
import { resolveAppDataPath } from "@/persistence/data-root";
import {
  isEnterpriseRevisionConflict,
  readRemoteEnterpriseCatalog,
  writeRemoteEnterpriseCatalog,
} from "@/enterprise/remote-store";
import type {
  Enterprise,
  EnterpriseAuditEvent,
  EnterpriseAuditEventType,
  EnterpriseCatalog,
  EnterpriseJobRole,
  EnterpriseJoinRequest,
  EnterpriseMember,
  EnterpriseMemberRole,
} from "@/enterprise/types";

const MAX_REMOTE_ATTEMPTS = 6;
const FILE = () => resolveAppDataPath("enterprises.json");

function emptyCatalog(): EnterpriseCatalog {
  return { version: 1, enterprises: [], joinRequests: [], auditEvents: [] };
}

function normalizeCatalog(value: unknown): EnterpriseCatalog {
  if (!value || typeof value !== "object") return emptyCatalog();
  const raw = value as Partial<EnterpriseCatalog>;
  return {
    version: 1,
    enterprises: Array.isArray(raw.enterprises) ? raw.enterprises : [],
    joinRequests: Array.isArray(raw.joinRequests) ? raw.joinRequests : [],
    auditEvents: Array.isArray(raw.auditEvents) ? raw.auditEvents : [],
  };
}

async function readLocal(): Promise<EnterpriseCatalog> {
  try {
    return normalizeCatalog(JSON.parse(await fs.readFile(FILE(), "utf-8")));
  } catch {
    return emptyCatalog();
  }
}

async function writeLocal(catalog: EnterpriseCatalog): Promise<void> {
  await fs.mkdir(path.dirname(FILE()), { recursive: true });
  const temporary = `${FILE()}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(catalog, null, 2), "utf-8");
  await fs.rename(temporary, FILE());
}

async function readCatalog(): Promise<EnterpriseCatalog> {
  if (!isRemoteDataOnly()) return readLocal();
  const document = await readRemoteEnterpriseCatalog();
  return normalizeCatalog(document?.value);
}

async function mutateCatalog<T>(
  mutation: (catalog: EnterpriseCatalog) => T,
): Promise<T> {
  if (!isRemoteDataOnly()) {
    const catalog = await readLocal();
    const result = mutation(catalog);
    await writeLocal(catalog);
    return result;
  }
  for (let attempt = 0; attempt < MAX_REMOTE_ATTEMPTS; attempt += 1) {
    const document = await readRemoteEnterpriseCatalog();
    const catalog = normalizeCatalog(document?.value);
    const result = mutation(catalog);
    try {
      await writeRemoteEnterpriseCatalog({
        expectedRevision: document?.revision ?? 0,
        value: catalog,
      });
      return result;
    } catch (error) {
      if (isEnterpriseRevisionConflict(error)) continue;
      throw error;
    }
  }
  throw new Error("ENTERPRISE_WRITE_CONFLICT");
}

function accountId(): string {
  return `ENT-${randomBytes(4).toString("hex").toUpperCase()}`;
}

function audit(
  enterpriseId: string,
  type: EnterpriseAuditEventType,
  actorUserId: string,
  summary: string,
  targetUserId: string | null = null,
  projectId: string | null = null,
): EnterpriseAuditEvent {
  return {
    id: `ea_${randomUUID()}`,
    enterpriseId,
    type,
    actorUserId,
    targetUserId,
    projectId,
    summary,
    createdAt: new Date().toISOString(),
  };
}

export async function listEnterprisesForUser(userId: string): Promise<Enterprise[]> {
  const catalog = await readCatalog();
  return catalog.enterprises
    .filter((enterprise) => enterprise.members.some((member) => member.userId === userId))
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
}

export async function enterpriseSpaceOverviewForUser(userId: string): Promise<{
  enterprises: Enterprise[];
  pendingJoinRequests: Array<{
    request: EnterpriseJoinRequest;
    enterprise: Enterprise;
  }>;
}> {
  const catalog = await readCatalog();
  const enterpriseMap = new Map(
    catalog.enterprises.map((enterprise) => [enterprise.id, enterprise]),
  );
  return {
    enterprises: catalog.enterprises
      .filter((enterprise) =>
        enterprise.members.some((member) => member.userId === userId),
      )
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN")),
    pendingJoinRequests: catalog.joinRequests.flatMap((request) => {
      if (request.applicantUserId !== userId || request.status !== "PENDING") {
        return [];
      }
      const enterprise = enterpriseMap.get(request.enterpriseId);
      return enterprise ? [{ request, enterprise }] : [];
    }),
  };
}

export async function listEnterpriseProjectIdsForUser(userId: string): Promise<string[]> {
  const enterprises = await listEnterprisesForUser(userId);
  return [...new Set(enterprises.flatMap((enterprise) => enterprise.projectIds))];
}

export async function getEnterprise(enterpriseId: string): Promise<Enterprise | null> {
  const catalog = await readCatalog();
  return catalog.enterprises.find((item) => item.id === enterpriseId) ?? null;
}

export async function getEnterpriseForProject(projectId: string): Promise<Enterprise | null> {
  const catalog = await readCatalog();
  return catalog.enterprises.find((enterprise) =>
    enterprise.projectIds.includes(projectId),
  ) ?? null;
}

export async function findEnterpriseByAccountId(
  rawAccountId: string,
): Promise<Pick<Enterprise, "id" | "accountId" | "name"> | null> {
  const wanted = rawAccountId.trim().toUpperCase();
  if (!/^ENT-[A-Z0-9]{6,20}$/.test(wanted)) return null;
  const catalog = await readCatalog();
  const enterprise = catalog.enterprises.find(
    (item) => item.accountId.toUpperCase() === wanted,
  );
  return enterprise
    ? { id: enterprise.id, accountId: enterprise.accountId, name: enterprise.name }
    : null;
}

export async function createEnterprise(input: {
  name: string;
  ownerUserId: string;
}): Promise<Enterprise> {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) throw new Error("企业名称需要 2 到 80 个字符");
  return mutateCatalog((catalog) => {
    const now = new Date().toISOString();
    let nextAccountId = accountId();
    while (catalog.enterprises.some((item) => item.accountId === nextAccountId)) {
      nextAccountId = accountId();
    }
    const enterprise: Enterprise = {
      id: `ent_${randomUUID()}`,
      accountId: nextAccountId,
      name,
      ownerUserId: input.ownerUserId,
      members: [
        {
          userId: input.ownerUserId,
          enterpriseRole: "OWNER",
          jobRole: "PRODUCER",
          joinedAt: now,
          invitedByUserId: null,
        },
      ],
      projectIds: [],
      createdAt: now,
      updatedAt: now,
    };
    catalog.enterprises.push(enterprise);
    catalog.auditEvents.push(
      audit(enterprise.id, "ENTERPRISE_CREATED", input.ownerUserId, `创建企业「${name}」`),
    );
    return enterprise;
  });
}

export async function submitEnterpriseJoinRequest(input: {
  enterpriseId: string;
  applicantUserId: string;
  message?: string;
}): Promise<EnterpriseJoinRequest> {
  return mutateCatalog((catalog) => {
    const enterprise = catalog.enterprises.find((item) => item.id === input.enterpriseId);
    if (!enterprise) throw new Error("企业不存在");
    if (enterprise.members.some((member) => member.userId === input.applicantUserId)) {
      throw new Error("你已经是该企业成员");
    }
    const existing = catalog.joinRequests.find(
      (request) =>
        request.enterpriseId === input.enterpriseId &&
        request.applicantUserId === input.applicantUserId &&
        request.status === "PENDING",
    );
    if (existing) return existing;
    const request: EnterpriseJoinRequest = {
      id: `ejr_${randomUUID()}`,
      enterpriseId: input.enterpriseId,
      applicantUserId: input.applicantUserId,
      status: "PENDING",
      message: input.message?.trim().slice(0, 200) ?? "",
      createdAt: new Date().toISOString(),
      decidedAt: null,
      decidedByUserId: null,
    };
    catalog.joinRequests.push(request);
    catalog.auditEvents.push(
      audit(enterprise.id, "JOIN_REQUEST_SUBMITTED", input.applicantUserId, "提交加入企业申请", input.applicantUserId),
    );
    return request;
  });
}

export async function listEnterpriseJoinRequests(
  enterpriseId: string,
): Promise<EnterpriseJoinRequest[]> {
  const catalog = await readCatalog();
  return catalog.joinRequests
    .filter((request) => request.enterpriseId === enterpriseId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function listJoinRequestsForApplicant(
  applicantUserId: string,
): Promise<EnterpriseJoinRequest[]> {
  const catalog = await readCatalog();
  return catalog.joinRequests
    .filter((request) => request.applicantUserId === applicantUserId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function decideEnterpriseJoinRequest(input: {
  enterpriseId: string;
  requestId: string;
  actorUserId: string;
  decision: "APPROVED" | "REJECTED";
}): Promise<EnterpriseJoinRequest> {
  return mutateCatalog((catalog) => {
    const enterprise = catalog.enterprises.find((item) => item.id === input.enterpriseId);
    const request = catalog.joinRequests.find(
      (item) => item.id === input.requestId && item.enterpriseId === input.enterpriseId,
    );
    if (!enterprise || !request) throw new Error("申请不存在");
    if (request.status !== "PENDING") throw new Error("申请已处理");
    request.status = input.decision;
    request.decidedAt = new Date().toISOString();
    request.decidedByUserId = input.actorUserId;
    if (input.decision === "APPROVED" && !enterprise.members.some((m) => m.userId === request.applicantUserId)) {
      enterprise.members.push({
        userId: request.applicantUserId,
        enterpriseRole: "MEMBER",
        jobRole: "CARD_ENGINEER",
        joinedAt: request.decidedAt,
        invitedByUserId: input.actorUserId,
      });
      enterprise.updatedAt = request.decidedAt;
    }
    catalog.auditEvents.push(
      audit(
        enterprise.id,
        input.decision === "APPROVED" ? "JOIN_REQUEST_APPROVED" : "JOIN_REQUEST_REJECTED",
        input.actorUserId,
        input.decision === "APPROVED" ? "通过加入企业申请" : "驳回加入企业申请",
        request.applicantUserId,
      ),
    );
    return request;
  });
}

export async function updateEnterpriseMember(input: {
  enterpriseId: string;
  targetUserId: string;
  actorUserId: string;
  jobRole?: EnterpriseJobRole;
  enterpriseRole?: Exclude<EnterpriseMemberRole, "OWNER">;
}): Promise<EnterpriseMember> {
  return mutateCatalog((catalog) => {
    const enterprise = catalog.enterprises.find((item) => item.id === input.enterpriseId);
    const member = enterprise?.members.find((item) => item.userId === input.targetUserId);
    if (!enterprise || !member) throw new Error("企业成员不存在");
    if (member.enterpriseRole === "OWNER") throw new Error("不能修改企业所有者");
    if (input.jobRole && input.jobRole !== member.jobRole) {
      member.jobRole = input.jobRole;
      catalog.auditEvents.push(
        audit(enterprise.id, "MEMBER_JOB_ROLE_CHANGED", input.actorUserId, `调整成员职务为 ${input.jobRole}`, member.userId),
      );
    }
    if (input.enterpriseRole && input.enterpriseRole !== member.enterpriseRole) {
      member.enterpriseRole = input.enterpriseRole;
      catalog.auditEvents.push(
        audit(enterprise.id, "MEMBER_ENTERPRISE_ROLE_CHANGED", input.actorUserId, `调整企业身份为 ${input.enterpriseRole}`, member.userId),
      );
    }
    enterprise.updatedAt = new Date().toISOString();
    return member;
  });
}

export async function removeEnterpriseMember(input: {
  enterpriseId: string;
  targetUserId: string;
  actorUserId: string;
}): Promise<void> {
  await mutateCatalog((catalog) => {
    const enterprise = catalog.enterprises.find((item) => item.id === input.enterpriseId);
    if (!enterprise) throw new Error("企业不存在");
    const member = enterprise.members.find((item) => item.userId === input.targetUserId);
    if (!member) throw new Error("企业成员不存在");
    if (member.enterpriseRole === "OWNER") throw new Error("不能移除企业所有者");
    if (input.targetUserId === input.actorUserId) {
      throw new Error("不能通过成员管理移除自己");
    }
    enterprise.members = enterprise.members.filter((item) => item.userId !== input.targetUserId);
    enterprise.updatedAt = new Date().toISOString();
    catalog.auditEvents.push(
      audit(enterprise.id, "MEMBER_REMOVED", input.actorUserId, "移除企业成员", input.targetUserId),
    );
  });
}

export async function inviteEnterpriseMember(input: {
  enterpriseId: string;
  targetUserId: string;
  actorUserId: string;
  jobRole: EnterpriseJobRole;
}): Promise<EnterpriseMember> {
  return mutateCatalog((catalog) => {
    const enterprise = catalog.enterprises.find((item) => item.id === input.enterpriseId);
    if (!enterprise) throw new Error("企业不存在");
    if (enterprise.members.some((member) => member.userId === input.targetUserId)) {
      throw new Error("该用户已经是企业成员");
    }
    const now = new Date().toISOString();
    const member: EnterpriseMember = {
      userId: input.targetUserId,
      enterpriseRole: "MEMBER",
      jobRole: input.jobRole,
      joinedAt: now,
      invitedByUserId: input.actorUserId,
    };
    enterprise.members.push(member);
    enterprise.updatedAt = now;
    for (const request of catalog.joinRequests) {
      if (
        request.enterpriseId === enterprise.id &&
        request.applicantUserId === input.targetUserId &&
        request.status === "PENDING"
      ) {
        request.status = "APPROVED";
        request.decidedAt = now;
        request.decidedByUserId = input.actorUserId;
      }
    }
    catalog.auditEvents.push(
      audit(enterprise.id, "MEMBER_INVITED", input.actorUserId, "直接邀请成员加入企业", input.targetUserId),
    );
    return member;
  });
}

export async function leaveEnterprise(input: {
  enterpriseId: string;
  userId: string;
}): Promise<void> {
  await mutateCatalog((catalog) => {
    const enterprise = catalog.enterprises.find((item) => item.id === input.enterpriseId);
    if (!enterprise) throw new Error("企业不存在");
    const member = enterprise.members.find((item) => item.userId === input.userId);
    if (!member) throw new Error("你不是该企业成员");
    if (member.enterpriseRole === "OWNER") {
      throw new Error("企业所有者需先转让所有权或解散企业");
    }
    enterprise.members = enterprise.members.filter((item) => item.userId !== input.userId);
    enterprise.updatedAt = new Date().toISOString();
    catalog.auditEvents.push(
      audit(enterprise.id, "MEMBER_LEFT", input.userId, "成员主动退出企业", input.userId),
    );
  });
}

export async function transferEnterpriseOwnership(input: {
  enterpriseId: string;
  ownerUserId: string;
  targetUserId: string;
}): Promise<Enterprise> {
  return mutateCatalog((catalog) => {
    const enterprise = catalog.enterprises.find((item) => item.id === input.enterpriseId);
    if (!enterprise) throw new Error("企业不存在");
    if (enterprise.ownerUserId !== input.ownerUserId) throw new Error("仅企业所有者可以转让所有权");
    if (input.targetUserId === input.ownerUserId) throw new Error("新所有者不能是当前所有者");
    const currentOwner = enterprise.members.find((item) => item.userId === input.ownerUserId);
    const target = enterprise.members.find((item) => item.userId === input.targetUserId);
    if (!currentOwner || !target) throw new Error("新所有者必须是现有企业成员");
    currentOwner.enterpriseRole = "ADMIN";
    target.enterpriseRole = "OWNER";
    enterprise.ownerUserId = target.userId;
    enterprise.updatedAt = new Date().toISOString();
    catalog.auditEvents.push(
      audit(enterprise.id, "OWNERSHIP_TRANSFERRED", input.ownerUserId, "转让企业所有权", target.userId),
    );
    return enterprise;
  });
}

export async function dissolveEnterprise(input: {
  enterpriseId: string;
  ownerUserId: string;
}): Promise<void> {
  await mutateCatalog((catalog) => {
    const enterprise = catalog.enterprises.find((item) => item.id === input.enterpriseId);
    if (!enterprise) throw new Error("企业不存在");
    if (enterprise.ownerUserId !== input.ownerUserId) throw new Error("仅企业所有者可以解散企业");
    catalog.enterprises = catalog.enterprises.filter((item) => item.id !== enterprise.id);
    catalog.joinRequests = catalog.joinRequests.filter((request) => request.enterpriseId !== enterprise.id);
    catalog.auditEvents = catalog.auditEvents.filter((event) => event.enterpriseId !== enterprise.id);
  });
}

export async function listEnterpriseAuditEvents(
  enterpriseId: string,
): Promise<EnterpriseAuditEvent[]> {
  const catalog = await readCatalog();
  return catalog.auditEvents
    .filter((event) => event.enterpriseId === enterpriseId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function assignEnterpriseProjects(input: {
  enterpriseId: string;
  projectIds: string[];
  actorUserId: string;
}): Promise<Enterprise> {
  return mutateCatalog((catalog) => {
    const enterprise = catalog.enterprises.find((item) => item.id === input.enterpriseId);
    if (!enterprise) throw new Error("企业不存在");
    const projectIds = [...new Set(input.projectIds.map((id) => id.trim()).filter(Boolean))];
    const conflictingEnterprise = catalog.enterprises.find(
      (item) =>
        item.id !== enterprise.id &&
        item.projectIds.some((projectId) => projectIds.includes(projectId)),
    );
    if (conflictingEnterprise) {
      throw new Error(`项目已归属企业「${conflictingEnterprise.name}」`);
    }
    enterprise.projectIds = projectIds;
    enterprise.updatedAt = new Date().toISOString();
    catalog.auditEvents.push(
      audit(enterprise.id, "PROJECTS_ASSIGNED", input.actorUserId, `更新企业项目范围，共 ${enterprise.projectIds.length} 个项目`),
    );
    return enterprise;
  });
}
