"use client";

import {
  Clapperboard,
  ImageIcon,
  Mic2,
  Mountain,
  Package,
  Type,
  UserRound,
  X,
} from "lucide-react";
import { AssetThumb } from "@/workflow/components/AssetThumb";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { listIncomingReferences } from "@/workflow/lib/reference-previews";
import type { IncomingReference } from "@/workflow/lib/reference-previews";
import { useWorkflowStore } from "@/workflow/store";
import type { WorkflowNodeType } from "@/workflow/types";

type Props = {
  nodeId: string;
};

function typeIcon(type: WorkflowNodeType) {
  switch (type) {
    case "character":
      return <UserRound className="h-3.5 w-3.5" />;
    case "scene":
      return <Mountain className="h-3.5 w-3.5" />;
    case "videoShot":
      return <Clapperboard className="h-3.5 w-3.5" />;
    case "image":
      return <ImageIcon className="h-3.5 w-3.5" />;
    case "prop":
      return <Package className="h-3.5 w-3.5" />;
    case "audio":
      return <Mic2 className="h-3.5 w-3.5" />;
    case "text":
      return <Type className="h-3.5 w-3.5" />;
  }
}

function refsEqual(a: IncomingReference[], b: IncomingReference[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (
      a[i].edgeId !== b[i].edgeId ||
      a[i].thumbUrl !== b[i].thumbUrl ||
      a[i].label !== b[i].label
    ) {
      return false;
    }
  }
  return true;
}

export function PromptReferenceChips({ nodeId }: Props) {
  const refs = useStoreWithEqualityFn(
    useWorkflowStore,
    (s) => listIncomingReferences(s.document, nodeId),
    refsEqual,
  );
  const removeEdge = useWorkflowStore((s) => s.removeEdge);

  if (refs.length === 0) return null;

  return (
    <div className="nodrag nopan mb-2 flex flex-wrap gap-1.5 px-0.5">
      {refs.map((ref) => (
        <div
          key={ref.edgeId}
          className="group relative h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-white/70 bg-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
          title={`${ref.label}（点击 × 解除参考）`}
        >
          {ref.thumbUrl ? (
            <div className="relative h-full w-full">
              <AssetThumb src={ref.thumbUrl} alt={ref.label} sizes="44px" />
            </div>
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-0.5 bg-zinc-100 text-zinc-500">
              {typeIcon(ref.sourceType)}
            </div>
          )}
          <button
            type="button"
            className="absolute right-0.5 top-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full border border-white/80 bg-zinc-900/75 text-white opacity-90 transition hover:bg-zinc-900"
            title="解除参考"
            onClick={(e) => {
              e.stopPropagation();
              removeEdge(ref.edgeId);
            }}
          >
            <X className="h-2.5 w-2.5" strokeWidth={2.5} />
          </button>
        </div>
      ))}
    </div>
  );
}
