"use client";

import { useMemo, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { HANDLES } from "@/workflow/connection-rules";
import { buildVideoGenerationInput } from "@/workflow/lib/build-video-generation-input";
import { useWorkflowStore } from "@/workflow/store";
import type {
  VideoGenerationInput,
  VideoGeneratorNodeData,
  WorkflowDocument,
  WorkflowNodeType,
} from "@/workflow/types";

function countByHandle(
  document: WorkflowDocument,
  videoNodeId: string,
  handle: string,
  type: WorkflowNodeType,
) {
  return document.edges.filter(
    (edge) =>
      edge.target === videoNodeId &&
      edge.targetHandle === handle &&
      document.nodes.some((n) => n.id === edge.source && n.type === type),
  ).length;
}

export function VideoGeneratorNodeView({ id, selected }: NodeProps) {
  const document = useWorkflowStore((s) => s.document);
  const nodeData = useWorkflowStore(
    (s) =>
      s.document.nodes.find((n) => n.id === id)?.data as
        | VideoGeneratorNodeData
        | undefined,
  );
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const [preview, setPreview] = useState<VideoGenerationInput | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const summary = useMemo(
    () => ({
      characterCount: countByHandle(
        document,
        id,
        HANDLES.characterInput,
        "character",
      ),
      sceneCount: countByHandle(document, id, HANDLES.sceneInput, "scene"),
      imageCount: countByHandle(document, id, HANDLES.imageInput, "image"),
      textCount: countByHandle(document, id, HANDLES.textInput, "text"),
      audioCount: countByHandle(document, id, HANDLES.audioInput, "audio"),
      hasDirector:
        countByHandle(document, id, HANDLES.directorInput, "director") > 0,
    }),
    [document, id],
  );

  if (!nodeData) return null;

  const onGenerate = () => {
    const result = buildVideoGenerationInput(document, id);
    if (!result.ok) {
      setPreview(null);
      setErrors(result.errors);
      return;
    }
    setErrors([]);
    setPreview(result.input);
  };

  return (
    <div
      className={`w-80 rounded-xl border bg-zinc-900/95 p-3 shadow-lg ${
        selected
          ? "border-emerald-400 ring-1 ring-emerald-400/40"
          : "border-zinc-700"
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        id={HANDLES.characterInput}
        style={{ top: "14%" }}
        className="!h-2.5 !w-2.5 !border-2 !border-zinc-900 !bg-orange-400"
      />
      <Handle
        type="target"
        position={Position.Left}
        id={HANDLES.sceneInput}
        style={{ top: "28%" }}
        className="!h-2.5 !w-2.5 !border-2 !border-zinc-900 !bg-teal-400"
      />
      <Handle
        type="target"
        position={Position.Left}
        id={HANDLES.directorInput}
        style={{ top: "42%" }}
        className="!h-2.5 !w-2.5 !border-2 !border-zinc-900 !bg-sky-400"
      />
      <Handle
        type="target"
        position={Position.Left}
        id={HANDLES.imageInput}
        style={{ top: "56%" }}
        className="!h-2.5 !w-2.5 !border-2 !border-zinc-900 !bg-violet-400"
      />
      <Handle
        type="target"
        position={Position.Left}
        id={HANDLES.textInput}
        style={{ top: "70%" }}
        className="!h-2.5 !w-2.5 !border-2 !border-zinc-900 !bg-cyan-400"
      />
      <Handle
        type="target"
        position={Position.Left}
        id={HANDLES.audioInput}
        style={{ top: "84%" }}
        className="!h-2.5 !w-2.5 !border-2 !border-zinc-900 !bg-amber-400"
      />

      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-300">
        视频生成
      </div>
      <div className="mb-2 truncate text-sm font-medium text-zinc-100">
        {nodeData.title || "未命名生成器"}
      </div>

      <textarea
        className="nodrag nopan nowheel mb-2 h-16 w-full resize-none rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-[11px] text-zinc-200 outline-none focus:border-emerald-500"
        value={nodeData.generationInstruction}
        placeholder="在此填写主要视频生成描述…"
        onChange={(e) =>
          updateNodeData(id, { generationInstruction: e.target.value })
        }
        onMouseDown={(e) => e.stopPropagation()}
      />

      <div className="mb-2 space-y-0.5 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2 text-[11px] text-zinc-400">
        <div>角色参考：{summary.characterCount} 个</div>
        <div>场景参考：{summary.sceneCount} 个</div>
        <div>图片参考：{summary.imageCount} 个</div>
        <div>文本输入：{summary.textCount} 个</div>
        <div>音频输入：{summary.audioCount} 个</div>
        <div>导演参数：{summary.hasDirector ? "已配置" : "未连接"}</div>
      </div>

      <div className="mb-2 text-[11px] text-zinc-500">
        {nodeData.aspectRatio} · {nodeData.duration}s · {nodeData.model}
      </div>

      <button
        type="button"
        className="nodrag nopan w-full rounded-lg border border-emerald-700/60 bg-emerald-950/50 px-2 py-1.5 text-xs text-emerald-200"
        onClick={(e) => {
          e.stopPropagation();
          onGenerate();
        }}
      >
        生成（预览请求）
      </button>

      {errors.length > 0 && (
        <ul className="mt-2 space-y-1 text-[11px] text-rose-300">
          {errors.map((err) => (
            <li key={err}>{err}</li>
          ))}
        </ul>
      )}

      {preview && (
        <div className="nodrag nopan mt-2 max-h-40 overflow-auto rounded-lg border border-amber-500/30 bg-amber-950/40 p-2 text-[11px] text-amber-100">
          <div className="mb-1 font-medium text-amber-200">
            尚未连接真实 AI 视频服务
          </div>
          <pre className="whitespace-pre-wrap break-all text-[10px] text-amber-100/80">
            {JSON.stringify(preview, null, 2)}
          </pre>
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        id={HANDLES.videoOutput}
        className="!h-3 !w-3 !border-2 !border-zinc-900 !bg-emerald-400"
      />
    </div>
  );
}
