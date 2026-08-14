"use client";

import type { CharacterAsset } from "@/projects/assets/types";
import { characterDisplayStatus } from "@/projects/assets/status";
import {
  AssetCompactList,
  AssetListPanelHeader,
} from "@/projects/assets/AssetCompactList";

type Props = {
  projectId: string;
  characters: CharacterAsset[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  canEdit: boolean;
  imageRevisions?: Record<string, number>;
  /** When true, only render the scrollable list (header provided by layout). */
  listOnly?: boolean;
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
  listOnly = false,
}: Props) {
  const list = (
    <AssetCompactList
      projectId={projectId}
      selectedId={selectedId}
      onSelect={onSelect}
      emptyMessage="暂无角色。点击「新建角色」开始准备资产。"
      testId="character-card-grid"
      items={characters.map((c) => {
        const status = characterDisplayStatus(c);
        return {
          id: c.id,
          name: c.name || "未命名角色",
          status,
          warn: !c.voiceId || status === "待完善",
          placeholder: initials(c.name),
          asset: c,
          revision: imageRevisions[c.id] ?? 0,
        };
      })}
    />
  );

  if (listOnly) return list;

  return (
    <section className="amw-panel" aria-label="角色列表">
      <div className="amw-panel__head">
        <AssetListPanelHeader
          title="角色列表"
          action={
            <button
              type="button"
              className="amw-btn amw-btn-primary"
              disabled={!canEdit}
              onClick={onCreate}
            >
              + 新建角色
            </button>
          }
        />
      </div>
      <div
        className="amw-panel__body asset-library__list-scroll"
        data-testid="character-library-scroll"
      >
        {list}
      </div>
    </section>
  );
}

export function CharacterListHeader({
  canEdit,
  onCreate,
}: {
  canEdit: boolean;
  onCreate: () => void;
}) {
  return (
    <AssetListPanelHeader
      title="角色列表"
      action={
        <button
          type="button"
          className="amw-btn amw-btn-primary"
          disabled={!canEdit}
          onClick={onCreate}
        >
          + 新建角色
        </button>
      }
    />
  );
}
