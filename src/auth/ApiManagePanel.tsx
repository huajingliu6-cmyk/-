"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { KeyRound, X } from "lucide-react";
import { CapabilityRulesTab } from "@/auth/ai-admin/CapabilityRulesTab";
import { ModelConnectionsTab } from "@/auth/ai-admin/ModelConnectionsTab";
import { TextGenerationsHistoryTab } from "@/auth/ai-admin/TextGenerationsHistoryTab";
import { AssetApprovalsHistoryTab } from "@/auth/ai-admin/AssetApprovalsHistoryTab";

type TabId = "models" | "rules" | "history" | "approvals";

type Props = {
  open: boolean;
  onClose: () => void;
};

const TABS: Array<{ id: TabId; label: string; testId: string }> = [
  {
    id: "models",
    label: "模型接入配置",
    testId: "ai-config-tab-models",
  },
  {
    id: "rules",
    label: "功能绑定与任务规则",
    testId: "ai-config-tab-rules",
  },
  {
    id: "history",
    label: "生成历史",
    testId: "ai-config-tab-history",
  },
  {
    id: "approvals",
    label: "审批记录",
    testId: "ai-config-tab-approvals",
  },
];

export function ApiManagePanel({ open, onClose }: Props) {
  const [tab, setTab] = useState<TabId>("models");
  const [prevOpen, setPrevOpen] = useState(open);

  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setTab("models");
    }
  }

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 p-4"
      onMouseDown={onClose}
    >
      <div
        className={`flex max-h-[min(88vh,calc(100vh-100px))] w-full flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-950 shadow-2xl ${
          tab === "history" || tab === "approvals" ? "max-w-4xl" : "max-w-3xl"
        }`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <KeyRound className="h-4 w-4 text-amber-300" />
            AI 模型配置中心
          </div>
          <button
            type="button"
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div
          className="flex shrink-0 gap-1 border-b border-zinc-800 px-4 pt-2"
          role="tablist"
        >
          {TABS.map((item) => {
            const selected = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                data-testid={item.testId}
                className={
                  selected
                    ? "rounded-t-lg border border-b-0 border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-100"
                    : "rounded-t-lg px-3 py-2 text-xs text-zinc-500 hover:bg-zinc-900/50 hover:text-zinc-300"
                }
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-4">
          {tab === "models" ? (
            <ModelConnectionsTab active={open && tab === "models"} />
          ) : tab === "rules" ? (
            <CapabilityRulesTab active={open && tab === "rules"} />
          ) : tab === "history" ? (
            <TextGenerationsHistoryTab active={open && tab === "history"} />
          ) : (
            <AssetApprovalsHistoryTab active={open && tab === "approvals"} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
