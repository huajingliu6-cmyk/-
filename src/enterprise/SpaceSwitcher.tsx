"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, ChevronDown, Plus, Search, UserRound, X } from "lucide-react";
import {
  ACTIVE_ENTERPRISE_EVENT,
  readActiveSpace,
  writeActiveSpace,
} from "@/enterprise/client-space";

type EnterpriseSummary = {
  id: string;
  accountId: string;
  name: string;
  memberRole: string;
  jobRole: string;
};

type SearchResult = Pick<EnterpriseSummary, "id" | "accountId" | "name">;
type PendingJoinRequest = {
  id: string;
  enterpriseId: string;
  enterpriseAccountId: string;
  enterpriseName: string;
  createdAt: string;
};

export function SpaceSwitcher() {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [enterprises, setEnterprises] = useState<EnterpriseSummary[]>([]);
  const [pendingJoinRequests, setPendingJoinRequests] = useState<PendingJoinRequest[]>([]);
  const [activeEnterpriseId, setActiveEnterpriseId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [accountId, setAccountId] = useState("");
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [note, setNote] = useState("");
  const [applying, setApplying] = useState(false);

  const reload = useCallback(async () => {
    await Promise.resolve();
    setLoading(true);
    try {
      const response = await fetch("/api/enterprises", { cache: "no-store" });
      const payload = (await response.json()) as {
        enterprises?: EnterpriseSummary[];
        pendingJoinRequests?: PendingJoinRequest[];
      };
      if (!response.ok) throw new Error();
      const next = payload.enterprises ?? [];
      setEnterprises(next);
      setPendingJoinRequests(payload.pendingJoinRequests ?? []);
      const saved = readActiveSpace();
      if (
        saved.kind === "enterprise" &&
        next.some((enterprise) => enterprise.id === saved.enterpriseId)
      ) {
        setActiveEnterpriseId(saved.enterpriseId);
      } else {
        setActiveEnterpriseId(null);
        if (saved.kind === "enterprise") writeActiveSpace({ kind: "personal" });
      }
    } catch {
      setEnterprises([]);
      setPendingJoinRequests([]);
      setActiveEnterpriseId(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  useEffect(() => {
    const changed = () => void reload();
    window.addEventListener(ACTIVE_ENTERPRISE_EVENT, changed);
    return () => window.removeEventListener(ACTIVE_ENTERPRISE_EVENT, changed);
  }, [reload]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  }, [open]);

  const activeEnterprise = enterprises.find(
    (enterprise) => enterprise.id === activeEnterpriseId,
  );

  const choosePersonal = () => {
    setActiveEnterpriseId(null);
    writeActiveSpace({ kind: "personal" });
    setOpen(false);
    router.push("/app/projects");
  };

  const chooseEnterprise = (enterprise: EnterpriseSummary) => {
    setActiveEnterpriseId(enterprise.id);
    writeActiveSpace({ kind: "enterprise", enterpriseId: enterprise.id });
    setOpen(false);
    router.push("/app/team");
  };

  const searchEnterprise = async () => {
    const normalized = accountId.trim().toUpperCase();
    setSearching(true);
    setResult(null);
    setNote("");
    try {
      const response = await fetch(
        `/api/enterprises/search?accountId=${encodeURIComponent(normalized)}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as {
        enterprise?: SearchResult | null;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "搜索失败");
      if (!payload.enterprise) {
        setNote("未找到该企业，请核对完整企业账号 ID。");
        return;
      }
      const foundEnterprise = payload.enterprise;
      setResult(foundEnterprise);
      if (pendingJoinRequests.some((request) => request.enterpriseId === foundEnterprise.id)) {
        setNote("你已提交过加入申请，当前正在等待企业管理员审核。");
      }
    } catch (error) {
      setNote(error instanceof Error ? error.message : "搜索失败");
    } finally {
      setSearching(false);
    }
  };

  const apply = async () => {
    if (!result) return;
    setApplying(true);
    setNote("");
    try {
      const response = await fetch(
        `/api/enterprises/${encodeURIComponent(result.id)}/join-requests`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: "申请加入企业团队" }),
        },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "提交申请失败");
      setNote("申请已提交，可在空间菜单中查看审核状态。");
      await reload();
    } catch (error) {
      setNote(error instanceof Error ? error.message : "提交申请失败");
    } finally {
      setApplying(false);
    }
  };

  return (
    <div ref={rootRef} className="space-switcher">
      <button
        type="button"
        className="space-switcher__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {activeEnterprise ? (
          <Building2 className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <UserRound className="h-3.5 w-3.5" aria-hidden />
        )}
        <span>{activeEnterprise?.name ?? "个人空间"}</span>
        <ChevronDown className="h-3.5 w-3.5" aria-hidden />
      </button>

      {open ? (
        <div className="space-switcher__menu" role="menu">
          <span className="space-switcher__eyebrow">切换空间</span>
          <button
            type="button"
            role="menuitem"
            className={`space-switcher__item${activeEnterpriseId ? "" : " is-active"}`}
            onClick={choosePersonal}
          >
            <span className="space-switcher__icon"><UserRound aria-hidden /></span>
            <span><strong>个人空间</strong><small>我的项目 · 无审批流程</small></span>
            {!activeEnterpriseId ? <Check aria-hidden /> : null}
          </button>
          {loading ? <p className="space-switcher__empty">正在加载企业团队…</p> : null}
          {!loading && enterprises.length === 0 ? (
            <p className="space-switcher__empty">你还没有加入企业团队。</p>
          ) : null}
          {enterprises.map((enterprise) => (
            <button
              key={enterprise.id}
              type="button"
              role="menuitem"
              className={`space-switcher__item${activeEnterpriseId === enterprise.id ? " is-active" : ""}`}
              onClick={() => chooseEnterprise(enterprise)}
            >
              <span className="space-switcher__icon"><Building2 aria-hidden /></span>
              <span><strong>{enterprise.name}</strong><small>{enterprise.accountId}</small></span>
              {activeEnterpriseId === enterprise.id ? <Check aria-hidden /> : null}
            </button>
          ))}
          {pendingJoinRequests.length > 0 ? (
            <div className="space-switcher__pending">
              <span>审核中的申请</span>
              {pendingJoinRequests.map((request) => (
                <div key={request.id}>
                  <span><strong>{request.enterpriseName}</strong><small>{request.enterpriseAccountId}</small></span>
                  <em>待审核</em>
                </div>
              ))}
            </div>
          ) : null}
          <div className="space-switcher__divider" />
          <button
            type="button"
            role="menuitem"
            className="space-switcher__join"
            onClick={() => { setOpen(false); setJoinOpen(true); setNote(""); }}
          >
            <Plus aria-hidden />申请加入企业团队
          </button>
        </div>
      ) : null}

      {joinOpen ? (
        <div className="space-join-backdrop" role="presentation" onMouseDown={() => setJoinOpen(false)}>
          <section
            className="space-join-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="space-join-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div><h2 id="space-join-title">申请加入企业团队</h2><p>输入完整企业账号 ID，找到企业后提交申请。</p></div>
              <button type="button" aria-label="关闭" onClick={() => setJoinOpen(false)}><X aria-hidden /></button>
            </header>
            <div className="space-join-search">
              <input
                value={accountId}
                onChange={(event) => setAccountId(event.target.value.toUpperCase())}
                placeholder="例如 ENT-1A2B3C4D"
                aria-label="企业账号 ID"
                onKeyDown={(event) => { if (event.key === "Enter") void searchEnterprise(); }}
              />
              <button type="button" disabled={searching} onClick={() => void searchEnterprise()}>
                <Search aria-hidden />{searching ? "搜索中…" : "搜索"}
              </button>
            </div>
            {result ? (
              <div className="space-join-result">
                <span className="space-switcher__icon"><Building2 aria-hidden /></span>
                <span><strong>{result.name}</strong><small>{result.accountId}</small></span>
                <button type="button" disabled={applying || pendingJoinRequests.some((request) => request.enterpriseId === result.id)} onClick={() => void apply()}>
                  {applying ? "提交中…" : pendingJoinRequests.some((request) => request.enterpriseId === result.id) ? "等待审核" : "申请加入"}
                </button>
              </div>
            ) : null}
            {note ? <p className="space-join-note">{note}</p> : null}
            <p className="space-join-privacy">企业仅能通过完整账号 ID 精确搜索，避免公开枚举企业信息。</p>
          </section>
        </div>
      ) : null}
    </div>
  );
}
