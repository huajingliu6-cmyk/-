"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Check, Coins, FolderKanban, ShieldCheck, Trash2, UserPlus, Users } from "lucide-react";
import {
  ACTIVE_ENTERPRISE_EVENT,
  readActiveSpace,
  writeActiveSpace,
  type ActiveSpace,
} from "@/enterprise/client-space";
import { ENTERPRISE_JOB_ROLE_LABELS, ENTERPRISE_ROLE_LABELS } from "@/enterprise/permissions";
import type { EnterpriseJobRole, EnterpriseMemberRole } from "@/enterprise/types";

type TabId = "members" | "requests" | "approvals" | "projects" | "audit";
type Dashboard = {
  enterprise: { id: string; accountId: string; name: string; projectIds: string[] };
  currentMember: { userId: string; enterpriseRole: EnterpriseMemberRole; jobRole: EnterpriseJobRole };
  permissions: { canAssignProjects: boolean; canAudit: boolean; canManageAdmins: boolean; canManageJobs: boolean; canReadApprovals: boolean; canRemoveMembers: boolean; canReviewRequests: boolean };
  stats: { memberCount: number; projectCount: number; pendingJoinRequestCount: number; pendingApprovalCount: number; spentCredits: number; creditBalance: number; frozenCredits: number };
  members: Array<{ userId: string; username: string; displayName: string; enterpriseRole: EnterpriseMemberRole; jobRole: EnterpriseJobRole; joinedAt: string }>;
  projects: Array<{ projectId: string; name: string; updatedAt: string }>;
  joinRequests: Array<{ id: string; applicantUserId: string; applicantUsername: string; applicantDisplayName: string; message: string; status: string; createdAt: string }>;
  approvals: Array<{ id: string; projectName: string; episodeId: string; status: string; submitter: string; approver: string; itemCount: number; submittedAt: string; completedAt: string | null }>;
  auditEvents: Array<{ id: string; kind: "CREDIT" | "ENTERPRISE"; actorName: string; targetName?: string | null; projectName?: string | null; delta: number | null; balanceAfter: number | null; reason: string; summary: string; createdAt: string }>;
};

type AssignableProject = { projectId: string; name: string; attached: boolean };

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "members", label: "成员与职务" },
  { id: "requests", label: "加入申请" },
  { id: "approvals", label: "审批记录" },
  { id: "projects", label: "项目范围" },
  { id: "audit", label: "操作日志" },
];

function formatTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("zh-CN", { hour12: false });
}

function statusLabel(status: string): string {
  return ({ pending: "待审批", partially_approved: "部分处理", approved: "已通过", rejected: "已驳回" } as Record<string, string>)[status] ?? status;
}

export function EnterpriseTeamPage() {
  const [space, setSpace] = useState<ActiveSpace>(() => readActiveSpace());
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [tab, setTab] = useState<TabId>("members");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [newEnterpriseName, setNewEnterpriseName] = useState("");
  const [creating, setCreating] = useState(false);
  const [assignableProjects, setAssignableProjects] = useState<AssignableProject[]>([]);
  const [savingProjects, setSavingProjects] = useState(false);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviteJobRole, setInviteJobRole] = useState<EnterpriseJobRole>("CARD_ENGINEER");
  const [inviting, setInviting] = useState(false);
  const [transferTargetUserId, setTransferTargetUserId] = useState("");
  const [lifecycleBusy, setLifecycleBusy] = useState(false);

  const reload = useCallback(async (active: ActiveSpace = space) => {
    await Promise.resolve();
    if (active.kind !== "enterprise") { setDashboard(null); return; }
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/enterprises/${encodeURIComponent(active.enterpriseId)}`, { cache: "no-store" });
      const payload = (await response.json()) as Dashboard & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "加载企业数据失败");
      setDashboard(payload);
    } catch (reason) {
      setDashboard(null);
      setError(reason instanceof Error ? reason.message : "加载企业数据失败");
    } finally { setLoading(false); }
  }, [space]);

  useEffect(() => {
    const timer = window.setTimeout(() => void reload(space), 0);
    return () => window.clearTimeout(timer);
  }, [reload, space]);

  useEffect(() => {
    const changed = (event: Event) => {
      const next = (event as CustomEvent<ActiveSpace>).detail ?? readActiveSpace();
      setSpace(next);
      setTab("members");
    };
    window.addEventListener(ACTIVE_ENTERPRISE_EVENT, changed);
    return () => window.removeEventListener(ACTIVE_ENTERPRISE_EVENT, changed);
  }, []);

  useEffect(() => {
    if (tab !== "projects" || space.kind !== "enterprise") return;
    void (async () => {
      const response = await fetch(`/api/enterprises/${encodeURIComponent(space.enterpriseId)}/projects`, { cache: "no-store" });
      const payload = (await response.json()) as { projects?: AssignableProject[] };
      if (response.ok) setAssignableProjects(payload.projects ?? []);
    })();
  }, [space, tab]);

  const canManageJobs = dashboard?.permissions.canManageJobs ?? false;
  const canManageAdmins = dashboard?.permissions.canManageAdmins ?? false;

  const createEnterprise = async () => {
    setCreating(true); setError("");
    try {
      const response = await fetch("/api/enterprises", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newEnterpriseName }) });
      const payload = (await response.json()) as { enterprise?: { id: string }; error?: string };
      if (!response.ok || !payload.enterprise) throw new Error(payload.error ?? "创建企业失败");
      const next: ActiveSpace = { kind: "enterprise", enterpriseId: payload.enterprise.id };
      writeActiveSpace(next); setSpace(next); setNewEnterpriseName("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "创建企业失败"); }
    finally { setCreating(false); }
  };

  const updateMember = async (userId: string, patch: { jobRole?: EnterpriseJobRole; enterpriseRole?: "ADMIN" | "MEMBER" }) => {
    if (space.kind !== "enterprise") return;
    setNote(""); setError("");
    const response = await fetch(`/api/enterprises/${encodeURIComponent(space.enterpriseId)}/members/${encodeURIComponent(userId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) { setError(payload.error ?? "更新成员失败"); return; }
    setNote("成员权限已更新"); await reload(space);
  };

  const decideRequest = async (requestId: string, decision: "APPROVED" | "REJECTED") => {
    if (space.kind !== "enterprise") return;
    const response = await fetch(`/api/enterprises/${encodeURIComponent(space.enterpriseId)}/join-requests`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId, decision }) });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) { setError(payload.error ?? "处理申请失败"); return; }
    setNote(decision === "APPROVED" ? "已通过加入申请" : "已驳回加入申请"); await reload(space);
  };

  const inviteMember = async () => {
    if (space.kind !== "enterprise") return;
    setInviting(true); setError(""); setNote("");
    try {
      const response = await fetch(`/api/enterprises/${encodeURIComponent(space.enterpriseId)}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: inviteUsername, jobRole: inviteJobRole }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "邀请成员失败");
      setInviteUsername(""); setNote("成员已加入企业团队"); await reload(space);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "邀请成员失败"); }
    finally { setInviting(false); }
  };

  const runLifecycle = async (action: "leave" | "transfer" | "dissolve") => {
    if (space.kind !== "enterprise" || !dashboard) return;
    if (action === "leave" && !window.confirm("确认退出当前企业？退出后将不能使用企业项目与企业积分。")) return;
    if (action === "transfer" && !transferTargetUserId) { setError("请选择新企业所有者"); return; }
    if (action === "transfer" && !window.confirm("确认转让企业所有权？转让后你将成为企业管理员。")) return;
    if (action === "dissolve") {
      const confirmation = window.prompt(`解散企业不可恢复，请输入企业账号 ID：${dashboard.enterprise.accountId}`);
      if (confirmation?.trim().toUpperCase() !== dashboard.enterprise.accountId) { setError("企业账号 ID 不匹配，已取消解散"); return; }
    }
    setLifecycleBusy(true); setError(""); setNote("");
    try {
      const response = await fetch(`/api/enterprises/${encodeURIComponent(space.enterpriseId)}/lifecycle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, targetUserId: transferTargetUserId || undefined }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "企业操作失败");
      if (action === "transfer") { setTransferTargetUserId(""); setNote("企业所有权已转让"); await reload(space); return; }
      const next: ActiveSpace = { kind: "personal" };
      writeActiveSpace(next); setSpace(next);
      setNote(action === "dissolve" ? "企业已解散" : "已退出企业");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "企业操作失败"); }
    finally { setLifecycleBusy(false); }
  };

  const removeMember = async (member: Dashboard["members"][number]) => {
    if (space.kind !== "enterprise") return;
    if (!window.confirm(`确认将「${member.displayName}」移出企业团队？`)) return;
    setRemovingUserId(member.userId); setNote(""); setError("");
    try {
      const response = await fetch(`/api/enterprises/${encodeURIComponent(space.enterpriseId)}/members/${encodeURIComponent(member.userId)}`, { method: "DELETE" });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "移除成员失败");
      setNote("成员已移出企业团队"); await reload(space);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "移除成员失败"); }
    finally { setRemovingUserId(null); }
  };

  const saveProjects = async () => {
    if (space.kind !== "enterprise") return;
    setSavingProjects(true);
    try {
      const response = await fetch(`/api/enterprises/${encodeURIComponent(space.enterpriseId)}/projects`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectIds: assignableProjects.filter((project) => project.attached).map((project) => project.projectId) }) });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "保存项目范围失败");
      setNote("企业项目范围已保存"); await reload(space);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "保存项目范围失败"); }
    finally { setSavingProjects(false); }
  };

  const visibleTabs = useMemo(() => TABS.filter((item) => {
    if (item.id === "requests") return dashboard?.permissions.canReviewRequests;
    if (item.id === "approvals") return dashboard?.permissions.canReadApprovals;
    if (item.id === "projects") return dashboard?.permissions.canAssignProjects;
    if (item.id === "audit") return dashboard?.permissions.canAudit;
    return true;
  }), [dashboard]);

  if (space.kind !== "enterprise") {
    return (
      <main className="ent-page"><div className="ent-empty-space">
        <span className="ent-empty-space__icon"><Building2 aria-hidden /></span>
        <h1>当前为个人空间</h1>
        <p>个人创作不需要团队管理与审批。你可以从右上角申请加入企业，或创建自己的企业团队。</p>
        <div className="ent-create"><input value={newEnterpriseName} onChange={(event) => setNewEnterpriseName(event.target.value)} placeholder="输入企业名称" maxLength={80} /><button type="button" disabled={creating || newEnterpriseName.trim().length < 2} onClick={() => void createEnterprise()}>{creating ? "创建中…" : "创建企业团队"}</button></div>
        {error ? <p className="ent-error">{error}</p> : null}
      </div></main>
    );
  }

  return (
    <main className="ent-page"><div className="ent-inner">
      {loading && !dashboard ? <p className="ent-muted">正在加载企业数据…</p> : null}
      {error ? <p className="ent-error">{error}</p> : null}
      {note ? <p className="ent-note">{note}</p> : null}
      {dashboard ? (<>
        <header className="ent-hero"><div><span className="ent-kicker">{dashboard.enterprise.accountId}</span><h1>{dashboard.enterprise.name} · 团队管理</h1><p>管理整个企业的成员、职务权限、项目范围、审批记录与积分使用日志。</p></div><span className="ent-role"><ShieldCheck aria-hidden />{ENTERPRISE_ROLE_LABELS[dashboard.currentMember.enterpriseRole]}</span></header>
        <section className="ent-stats">
          <article><Users aria-hidden /><span>企业成员</span><strong>{dashboard.stats.memberCount}</strong></article>
          <article><FolderKanban aria-hidden /><span>企业项目</span><strong>{dashboard.stats.projectCount}</strong></article>
          <article><UserPlus aria-hidden /><span>待处理申请</span><strong>{dashboard.stats.pendingJoinRequestCount}</strong></article>
          <article><Check aria-hidden /><span>待审批记录</span><strong>{dashboard.stats.pendingApprovalCount}</strong></article>
          <article><Coins aria-hidden /><span>累计使用积分</span><strong>{dashboard.stats.spentCredits}</strong></article>
          {dashboard.permissions.canAudit ? <article><Coins aria-hidden /><span>企业积分余额</span><strong>{dashboard.stats.creditBalance}</strong><small>冻结 {dashboard.stats.frozenCredits}</small></article> : null}
        </section>
        <nav className="ent-tabs" aria-label="团队管理栏目">{visibleTabs.map((item) => <button key={item.id} type="button" className={tab === item.id ? "is-active" : ""} onClick={() => setTab(item.id)}>{item.label}{item.id === "requests" && dashboard.stats.pendingJoinRequestCount ? ` · ${dashboard.stats.pendingJoinRequestCount}` : ""}</button>)}</nav>

        {tab === "members" ? <section className="ent-panel"><div className="ent-panel-head"><div><h2>成员与职务</h2><p>企业身份决定组织管理权限；制作职务决定业务职责，两者互不替代。</p></div></div><div className="ent-table-wrap"><table><thead><tr><th>成员</th><th>企业身份</th><th>制作职务</th><th>加入时间</th>{dashboard.permissions.canRemoveMembers ? <th>操作</th> : null}</tr></thead><tbody>{dashboard.members.map((member) => <tr key={member.userId}><td><span className="ent-member"><span>{(member.displayName || member.username).slice(0,1)}</span><span><strong>{member.displayName}</strong><small>@{member.username}</small></span></span></td><td>{canManageAdmins && member.enterpriseRole !== "OWNER" ? <select value={member.enterpriseRole} onChange={(event) => void updateMember(member.userId, { enterpriseRole: event.target.value as "ADMIN" | "MEMBER" })}><option value="ADMIN">企业管理员</option><option value="MEMBER">企业成员</option></select> : ENTERPRISE_ROLE_LABELS[member.enterpriseRole]}</td><td>{canManageJobs && member.enterpriseRole !== "OWNER" ? <select value={member.jobRole} onChange={(event) => void updateMember(member.userId, { jobRole: event.target.value as EnterpriseJobRole })}>{Object.entries(ENTERPRISE_JOB_ROLE_LABELS).map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select> : ENTERPRISE_JOB_ROLE_LABELS[member.jobRole]}</td><td>{formatTime(member.joinedAt)}</td>{dashboard.permissions.canRemoveMembers ? <td>{member.enterpriseRole === "OWNER" || member.userId === dashboard.currentMember.userId ? "—" : <button type="button" className="ent-remove-member" disabled={removingUserId === member.userId} onClick={() => void removeMember(member)}><Trash2 aria-hidden />{removingUserId === member.userId ? "移除中…" : "移除"}</button>}</td> : null}</tr>)}</tbody></table></div></section> : null}

        {tab === "members" && canManageJobs ? <section className="ent-panel ent-governance"><div className="ent-panel-head"><div><h2>直接邀请成员</h2><p>输入现有用户的完整用户名，并分配初始制作职务。</p></div></div><div className="ent-governance__row"><input value={inviteUsername} onChange={(event) => setInviteUsername(event.target.value)} placeholder="完整用户名" /><select value={inviteJobRole} onChange={(event) => setInviteJobRole(event.target.value as EnterpriseJobRole)}>{Object.entries(ENTERPRISE_JOB_ROLE_LABELS).map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select><button type="button" disabled={inviting || !inviteUsername.trim()} onClick={() => void inviteMember()}>{inviting ? "邀请中…" : "邀请加入"}</button></div></section> : null}

        {tab === "members" ? <section className="ent-panel ent-governance"><div className="ent-panel-head"><div><h2>企业生命周期</h2><p>所有权转让、退出和解散均不会改变项目管理员身份；企业钱包记录会保留用于财务审计。</p></div></div>{dashboard.currentMember.enterpriseRole === "OWNER" ? <div className="ent-governance__stack"><div className="ent-governance__row"><select value={transferTargetUserId} onChange={(event) => setTransferTargetUserId(event.target.value)}><option value="">选择新企业所有者</option>{dashboard.members.filter((member) => member.userId !== dashboard.currentMember.userId).map((member) => <option key={member.userId} value={member.userId}>{member.displayName} · {ENTERPRISE_JOB_ROLE_LABELS[member.jobRole]}</option>)}</select><button type="button" disabled={lifecycleBusy || !transferTargetUserId} onClick={() => void runLifecycle("transfer")}>转让所有权</button></div><button type="button" className="ent-danger-action" disabled={lifecycleBusy} onClick={() => void runLifecycle("dissolve")}>解散企业</button></div> : <button type="button" className="ent-danger-action" disabled={lifecycleBusy} onClick={() => void runLifecycle("leave")}>退出企业</button>}</section> : null}

        {tab === "requests" ? <section className="ent-panel"><div className="ent-panel-head"><div><h2>加入申请</h2><p>通过后成员默认成为企业成员与抽卡工程师，可再调整职务。</p></div></div><div className="ent-list">{dashboard.joinRequests.length === 0 ? <p className="ent-muted">暂无加入申请</p> : dashboard.joinRequests.map((request) => <article key={request.id}><div><strong>{request.applicantDisplayName}</strong><small>@{request.applicantUsername} · {formatTime(request.createdAt)}</small>{request.message ? <p>{request.message}</p> : null}</div><span className={`ent-status ent-status--${request.status.toLowerCase()}`}>{request.status === "PENDING" ? "待处理" : request.status === "APPROVED" ? "已通过" : "已驳回"}</span>{request.status === "PENDING" ? <div className="ent-actions"><button type="button" onClick={() => void decideRequest(request.id, "REJECTED")}>驳回</button><button type="button" className="is-primary" onClick={() => void decideRequest(request.id, "APPROVED")}>通过</button></div> : null}</article>)}</div></section> : null}

        {tab === "approvals" ? <section className="ent-panel"><div className="ent-panel-head"><div><h2>审批记录</h2><p>只显示明确归属当前企业的项目审批，不包含个人项目。</p></div></div><div className="ent-list">{dashboard.approvals.length === 0 ? <p className="ent-muted">暂无企业审批记录</p> : dashboard.approvals.map((approval) => <article key={approval.id}><div><strong>{approval.projectName} · {approval.episodeId}</strong><small>提交人 {approval.submitter} · 审批人 {approval.approver}</small><p>{approval.itemCount} 项素材 · 提交于 {formatTime(approval.submittedAt)}{approval.completedAt ? ` · 完成于 ${formatTime(approval.completedAt)}` : ""}</p></div><span className={`ent-status ent-status--${approval.status}`}>{statusLabel(approval.status)}</span></article>)}</div></section> : null}

        {tab === "projects" ? <section className="ent-panel"><div className="ent-panel-head"><div><h2>企业项目范围</h2><p>只有明确勾选的项目才会进入企业项目、审批汇总和积分操作日志。</p></div><button type="button" className="ent-save" disabled={savingProjects} onClick={() => void saveProjects()}>{savingProjects ? "保存中…" : "保存范围"}</button></div><div className="ent-project-grid">{assignableProjects.length === 0 ? <p className="ent-muted">暂无可分配项目</p> : assignableProjects.map((project) => <label key={project.projectId}><input type="checkbox" checked={project.attached} onChange={(event) => setAssignableProjects((current) => current.map((item) => item.projectId === project.projectId ? { ...item, attached: event.target.checked } : item))} /><span><strong>{project.name}</strong><small>{project.projectId}</small></span></label>)}</div></section> : null}

        {tab === "audit" ? <section className="ent-panel"><div className="ent-panel-head"><div><h2>操作日志与企业积分使用记录</h2><p>积分记录来自企业项目的真实成员流水；组织变更记录成员、职务与项目范围操作。</p></div></div><div className="ent-list ent-audit">{dashboard.auditEvents.length === 0 ? <p className="ent-muted">暂无操作日志</p> : dashboard.auditEvents.map((event) => <article key={event.id}><span className={`ent-event-icon ${event.kind === "CREDIT" ? "is-credit" : ""}`}>{event.kind === "CREDIT" ? <Coins aria-hidden /> : <ShieldCheck aria-hidden />}</span><div><strong>{event.summary}</strong><small>{event.actorName}{event.projectName ? ` · ${event.projectName}` : ""} · {formatTime(event.createdAt)}</small><p>{event.kind === "CREDIT" ? `${event.reason}${event.balanceAfter != null ? ` · 余额 ${event.balanceAfter}` : ""}` : event.reason}</p></div>{event.delta != null ? <span className={`ent-delta${event.delta < 0 ? " is-spend" : " is-refund"}`}>{event.delta > 0 ? "+" : ""}{event.delta}</span> : null}</article>)}</div></section> : null}
      </>) : null}
    </div></main>
  );
}
