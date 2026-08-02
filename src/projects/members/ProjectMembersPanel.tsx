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
    <section
      className="wb-members"
      data-testid="project-members-panel"
      style={{ marginTop: 28 }}
    >
      <h2 style={{ margin: "0 0 12px", fontSize: "1.1rem" }}>成员与权限</h2>
      <p className="wb-muted">项目主理人：{ownerLabel}</p>

      <div style={{ marginTop: 16 }}>
        <h3 style={{ margin: "0 0 8px", fontSize: "0.95rem" }}>
          抽卡工程师
        </h3>
        {engineers.length === 0 ? (
          <p className="wb-muted">尚未分配抽卡工程师</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {engineers.map((item) => (
              <li key={item.memberId} style={{ marginBottom: 8 }}>
                {item.displayName}（{item.username}）
                <button
                  type="button"
                  className="wb-btn"
                  style={{ marginLeft: 8, height: 32 }}
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

      <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索用户名或显示名"
          aria-label="搜索用户"
          style={{
            minWidth: 220,
            height: 36,
            borderRadius: 10,
            border: "1px solid rgba(167,139,250,0.35)",
            background: "rgba(15,10,28,0.6)",
            color: "#fff",
            padding: "0 10px",
          }}
        />
        <button
          type="button"
          className="wb-btn wb-btn-primary"
          disabled={busy}
          onClick={() => void search()}
        >
          搜索用户
        </button>
      </div>

      {results.length > 0 ? (
        <ul style={{ marginTop: 12, paddingLeft: 18 }}>
          {results.map((user) => (
            <li key={user.userId} style={{ marginBottom: 8 }}>
              {user.displayName}（{user.username}）
              <button
                type="button"
                className="wb-btn wb-btn-primary"
                style={{ marginLeft: 8, height: 32 }}
                disabled={busy}
                onClick={() => void addUser(user.userId)}
              >
                添加为抽卡工程师
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {note ? <p className="wb-note" style={{ marginTop: 10 }}>{note}</p> : null}
    </section>
  );
}
