"use client";

import { Pencil } from "lucide-react";
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
          <div className="amw-char-grid" data-testid="character-card-grid">
            {characters.map((c, index) => {
              const status = characterDisplayStatus(c);
              const warn = !c.voiceId || status === "待完善";
              const title = c.name || "未命名角色";
              const selected = selectedId === c.id;
              return (
                <article
                  key={c.id}
                  className={`amw-char-card${selected ? " is-selected" : ""}`}
                  style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
                  data-testid={`character-list-card-${c.id}`}
                >
                  <button
                    type="button"
                    className="amw-char-card__hit"
                    onClick={() => onSelect(c.id)}
                    title={title}
                  >
                    <p className="amw-char-card__name" title={title}>
                      {title}
                    </p>
                    <span className="amw-char-card__media" aria-hidden>
                      <AssetListThumb
                        projectId={projectId}
                        asset={c}
                        placeholder={initials(c.name)}
                        revision={imageRevisions[c.id] ?? 0}
                        fit="contain"
                      />
                    </span>
                  </button>
                  <div className="amw-char-card__foot">
                    <span
                      className={`amw-badge${warn ? " is-warn" : " is-ok"}`}
                    >
                      {status}
                    </span>
                    <div className="amw-char-card__actions">
                      <button
                        type="button"
                        className="amw-icon-btn"
                        title={canEdit ? "编辑" : "查看详情"}
                        aria-label={canEdit ? "编辑" : "查看详情"}
                        onClick={() => onSelect(c.id)}
                      >
                        <Pencil size={15} strokeWidth={2} aria-hidden />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
