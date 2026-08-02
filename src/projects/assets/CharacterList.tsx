"use client";

import type { CharacterAsset } from "@/projects/assets/types";
import { characterDisplayStatus } from "@/projects/assets/status";
import { AssetListThumb } from "@/projects/assets/AssetListThumb";

type Props = {
  projectId: string;
  characters: CharacterAsset[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  canEdit: boolean;
  imageRevisions?: Record<string, number>;
};

function initials(name: string): string {
  const t = name.trim();
  if (!t) return "?";
  return t.slice(0, 1);
}

export function CharacterList({
  projectId,
  characters,
  selectedId,
  onSelect,
  onCreate,
  canEdit,
  imageRevisions = {},
}: Props) {
  return (
    <section className="amw-panel" aria-label="角色列表">
      <div className="amw-panel__head">
        <h2>角色列表</h2>
        <button
          type="button"
          className="amw-btn amw-btn-primary"
          disabled={!canEdit}
          onClick={onCreate}
        >
          + 新建角色
        </button>
      </div>
      <div className="amw-panel__body">
        {characters.length === 0 ? (
          <div className="amw-empty">暂无角色。点击「新建角色」开始准备资产。</div>
        ) : (
          <div className="amw-list">
            {characters.map((c, index) => {
              const status = characterDisplayStatus(c);
              const warn = !c.voiceId || status === "待完善";
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`amw-card${selectedId === c.id ? " is-selected" : ""}`}
                  style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
                  onClick={() => onSelect(c.id)}
                >
                  <span className="amw-avatar" aria-hidden>
                    <AssetListThumb
                      projectId={projectId}
                      asset={c}
                      placeholder={initials(c.name)}
                      revision={imageRevisions[c.id] ?? 0}
                    />
                  </span>
                  <span className="amw-card__meta">
                    <p className="amw-card__title">{c.name || "未命名角色"}</p>
                    <p className="amw-card__sub">
                      {c.role || "未设定定位"}
                      {" · "}
                      {c.voiceId
                        ? c.voiceStyle || c.voiceName || "已绑定音色"
                        : "未绑定音色"}
                    </p>
                  </span>
                  <span className={`amw-badge${warn ? " is-warn" : " is-ok"}`}>
                    {status}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
