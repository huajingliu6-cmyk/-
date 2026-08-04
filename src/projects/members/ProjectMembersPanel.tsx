"use client";

import { useCallback, useEffect, useState } from "react";

type Engineer = {
  memberId: string;
  userId: string;
  username: string;
  displayName: string;
  createdAt: string;
};

type SearchUser = {
  userId: string;
  username: string;
  displayName: string;
};

type Props = {
  projectId: string;
};

export function ProjectMembersPanel({ projectId }: Props) {
  const [ownerLabel, setOwnerLabel] = useState("");
  const [engineers, setEngineers] = useState<Engineer[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchUser[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(true);

  const applyMembersPayload = useCallback(
    (payload: {
      owner?: { displayName: string; username: string };
      cardEngineers?: Engineer[];
    }) => {
      setVisible(true);
      setOwnerLabel(
        payload.owner
          ? `${payload.owner.displayName}（${payload.owner.username}）`
          : "—",
      );
      setEngineers(payload.cardEngineers ?? []);
    },
    [],
  );

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void (async () => {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/members`,
      );
      if (cancelled) return;
      if (res.status === 403) {
        setVisible(false);
        return;
      }
      const payload = (await res.json()) as {
        owner?: { displayName: string; username: string };
        cardEngineers?: Engineer[];
        error?: string;
      };
      if (!res.ok) {
        setNote(payload.error ?? "无法加载成员");
        return;
      }
      applyMembersPayload(payload);
    })();
    return () => {
      cancelled = true;
    };
  }, [applyMembersPayload, projectId]);

  const reload = useCallback(async () => {
    const res = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/members`,
    );
    if (res.status === 403) {
      setVisible(false);
      return;
    }
    const payload = (await res.json()) as {
      owner?: { displayName: string; username: string };
      cardEngineers?: Engineer[];
      error?: string;
    };
    if (!res.ok) {
      setNote(payload.error ?? "无法加载成员");
      return;
    }
    applyMembersPayload(payload);
  }, [applyMembersPayload, projectId]);

  const search = async () => {
    setBusy(true);
    setNote("");
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/members`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ q: query }),
        },
      );
      const payload = (await res.json()) as {
        users?: SearchUser[];
        error?: string;
      };
      if (!res.ok) throw new Error(payload.error ?? "搜索失败");
      setResults(payload.users ?? []);
    } catch (error) {
      setNote(error instanceof Error ? error.message : "搜索失败");
    } finally {
      setBusy(false);
    }
  };

  const addUser = async (userId: string) => {
    setBusy(true);
    setNote("");
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/members`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
        },
      );
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? "添加失败");
      setNote("已添加抽卡工程师");
      setResults((prev) => prev.filter((u) => u.userId !== userId));
      await reload();
    } catch (error) {
      setNote(error instanceof Error ? error.message : "添加失败");
    } finally {
      setBusy(false);
    }
  };

  const removeUser = async (userId: string) => {
    setBusy(true);
    setNote("");
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/members?userId=${encodeURIComponent(userId)}`,
        { method: "DELETE" },
      );
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? "移除失败");
      setNote("已移除抽卡工程师");
      await reload();
    } catch (error) {
      setNote(error instanceof Error ? error.message : "移除失败");
    } finally {
      setBusy(false);
    }
  };

  if (!visible) return null;

  return (
    <section className="wb-members" data-testid="project-members-panel">
      <div className="wb-section-heading wb-members__heading">
        <div>
          <span>协作设置</span>
          <h2>成员与权限</h2>
        </div>
        <p>管理项目成员与权限。</p>
      </div>

      <div className="wb-owner-card">
        <span>项目主理人</span>
        <strong>{ownerLabel}</strong>
      </div>

      <div className="wb-members__group">
        <div className="wb-members__group-head">
          <div>
            <span>协作成员</span>
            <h3>抽卡工程师</h3>
          </div>
          <span className="wb-members__count">{engineers.length} 人</span>
        </div>

        {engineers.length === 0 ? (
          <div className="wb-members__empty">
            <strong>尚未分配抽卡工程师</strong>
            <span>搜索用户并添加后，对方即可参与项目资产工作。</span>
          </div>
        ) : (
          <ul className="wb-members__list">
            {engineers.map((item) => (
              <li key={item.memberId} className="wb-member-row">
                <span className="wb-member-avatar" aria-hidden>
                  {(item.displayName || item.username).slice(0, 1).toUpperCase()}
                </span>
                <span className="wb-member-identity">
                  <strong>{item.displayName}</strong>
                  <span>@{item.username}</span>
                </span>
                <button
                  type="button"
                  className="wb-btn wb-btn--danger"
                  disabled={busy}
                  onClick={() => void removeUser(item.userId)}
                >
                  移除
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="wb-member-search">
        <label htmlFor="project-member-search">添加抽卡工程师</label>
        <div className="wb-member-search__controls">
          <input
            id="project-member-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索用户名或显示名"
            aria-label="搜索用户"
          />
          <button
            type="button"
            className="wb-btn wb-btn-primary"
            disabled={busy}
            onClick={() => void search()}
          >
            {busy ? "处理中…" : "搜索用户"}
          </button>
        </div>
      </div>

      {results.length > 0 ? (
        <ul className="wb-members__results">
          {results.map((user) => (
            <li key={user.userId} className="wb-member-row">
              <span className="wb-member-avatar" aria-hidden>
                {(user.displayName || user.username).slice(0, 1).toUpperCase()}
              </span>
              <span className="wb-member-identity">
                <strong>{user.displayName}</strong>
                <span>@{user.username}</span>
              </span>
              <button
                type="button"
                className="wb-btn wb-btn-primary"
                disabled={busy}
                onClick={() => void addUser(user.userId)}
              >
                添加
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {note ? <p className="wb-note">{note}</p> : null}
    </section>
  );
}
