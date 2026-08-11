"use client";

import { useChipBounce } from "@/shell/useChipBounce";
import type { AssetTabId } from "@/projects/assets/types";

const TABS: Array<{ id: AssetTabId; label: string }> = [
  { id: "character", label: "角色管理" },
  { id: "scene", label: "场景管理" },
  { id: "prop", label: "道具管理" },
];

type Props = {
  active: AssetTabId;
  onChange: (tab: AssetTabId) => void;
};

export function AssetTabs({ active, onChange }: Props) {
  return (
    <div className="amw-tabs" role="tablist" aria-label="资产类型">
      {TABS.map((tab) => (
        <TabButton
          key={tab.id}
          label={tab.label}
          active={active === tab.id}
          onSelect={() => onChange(tab.id)}
        />
      ))}
    </div>
  );
}

function TabButton({
  label,
  active,
  onSelect,
}: {
  label: string;
  active: boolean;
  onSelect: () => void;
}) {
  const bounce = useChipBounce();
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`amw-tab${active ? " is-active" : ""} ${bounce.bounceClass}`}
      onClick={() => {
        bounce.trigger();
        onSelect();
      }}
      onAnimationEnd={bounce.onAnimationEnd}
    >
      {label}
    </button>
  );
}
