"use client";

import type { ReactNode } from "react";
import { useWorkflowStore } from "@/workflow/store";
import type {
  ImageNodeData,
  PromptNodeData,
  VideoGeneratorNodeData,
  VideoOutputNodeData,
  WorkflowNode,
} from "@/workflow/types";

const MODEL_OPTIONS = [
  { value: "demo-video-v1", label: "Demo Video v1（占位）" },
  { value: "demo-video-v2", label: "Demo Video v2（占位）" },
];

const ASPECT_OPTIONS = ["16:9", "9:16", "1:1"];
const RESOLUTION_OPTIONS = ["1280x720", "1920x1080", "720x1280"];

type Props = {
  nodeCount: number;
  edgeCount: number;
};

export function PropertiesPanel({ nodeCount, edgeCount }: Props) {
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const nodes = useWorkflowStore((s) => s.document.nodes);
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);

  const selected = nodes.find((n) => n.id === selectedNodeId) as
    | WorkflowNode
    | undefined;

  if (!selected) {
    return (
      <aside className="flex w-72 shrink-0 flex-col border-l border-zinc-800 bg-zinc-950/90 text-zinc-200">
        <div className="border-b border-zinc-800 px-3 py-3 text-xs font-semibold tracking-wide text-zinc-300">
          项目说明
        </div>
        <div className="space-y-4 overflow-auto p-3 text-xs leading-5 text-zinc-400">
          <p>
            这是 AI 视频工作流编辑器的开发预览。当前仅支持节点编排与本地保存，
            <span className="text-amber-300">尚未接入真实生成</span>。
          </p>
          <div>
            <div className="mb-1 font-medium text-zinc-300">快捷键</div>
            <ul className="list-disc space-y-1 pl-4">
              <li>滚轮：缩放画布</li>
              <li>拖动画布空白处：平移</li>
              <li>Delete / Backspace：删除选中</li>
              <li>Ctrl/Cmd + S：立即保存</li>
            </ul>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
            <div>节点数量：{nodeCount}</div>
            <div>连接数量：{edgeCount}</div>
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-zinc-800 bg-zinc-950/90 text-zinc-200">
      <div className="border-b border-zinc-800 px-3 py-3 text-xs font-semibold tracking-wide text-zinc-300">
        属性面板
      </div>
      <div className="flex-1 space-y-3 overflow-auto p-3 text-xs">
        {selected.type === "prompt" && (
          <PromptFields
            data={selected.data as PromptNodeData}
            onChange={(patch) => updateNodeData(selected.id, patch)}
          />
        )}
        {selected.type === "image" && (
          <ImageFields
            data={selected.data as ImageNodeData}
            onChange={(patch) => updateNodeData(selected.id, patch)}
          />
        )}
        {selected.type === "videoGenerator" && (
          <GeneratorFields
            data={selected.data as VideoGeneratorNodeData}
            onChange={(patch) => updateNodeData(selected.id, patch)}
          />
        )}
        {selected.type === "videoOutput" && (
          <OutputFields data={selected.data as VideoOutputNodeData} />
        )}
      </div>
    </aside>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <label className="mb-1 block text-[11px] text-zinc-400">{children}</label>;
}

function textInputClassName() {
  return "nodrag nopan w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-cyan-500";
}

function PromptFields({
  data,
  onChange,
}: {
  data: PromptNodeData;
  onChange: (patch: Partial<PromptNodeData>) => void;
}) {
  return (
    <>
      <div>
        <FieldLabel>标题</FieldLabel>
        <input
          className={textInputClassName()}
          value={data.title}
          onChange={(e) => onChange({ title: e.target.value })}
        />
      </div>
      <div>
        <FieldLabel>正向提示词</FieldLabel>
        <textarea
          className={`${textInputClassName()} min-h-28 resize-y`}
          value={data.prompt}
          onChange={(e) => onChange({ prompt: e.target.value })}
        />
      </div>
      <div>
        <FieldLabel>负向提示词</FieldLabel>
        <textarea
          className={`${textInputClassName()} min-h-20 resize-y`}
          value={data.negativePrompt}
          onChange={(e) => onChange({ negativePrompt: e.target.value })}
        />
      </div>
    </>
  );
}

function ImageFields({
  data,
  onChange,
}: {
  data: ImageNodeData;
  onChange: (patch: Partial<ImageNodeData>) => void;
}) {
  return (
    <>
      <div>
        <FieldLabel>标题</FieldLabel>
        <input
          className={textInputClassName()}
          value={data.title}
          onChange={(e) => onChange({ title: e.target.value })}
        />
      </div>
      <div>
        <FieldLabel>图片 URL</FieldLabel>
        <input
          className={textInputClassName()}
          value={data.assetUrl}
          placeholder="https://..."
          onChange={(e) =>
            onChange({
              assetUrl: e.target.value,
              uploadStatus: e.target.value ? "ready" : "empty",
              ephemeralHint: e.target.value.startsWith("blob:")
                ? "本地临时预览刷新后无法恢复，正式持久化将在 Supabase Storage 阶段实现"
                : undefined,
            })
          }
        />
      </div>
      <button
        type="button"
        className="nodrag nopan rounded-lg border border-zinc-700 px-2 py-1.5 text-zinc-300 hover:bg-zinc-900"
        onClick={() =>
          onChange({
            assetUrl: "",
            fileName: "",
            uploadStatus: "empty",
            ephemeralHint: undefined,
          })
        }
      >
        清除图片
      </button>
      <p className="text-[11px] leading-5 text-zinc-500">
        当前阶段不把图片 base64 写入工作流 JSON。真实文件上传留到后续阶段。
      </p>
    </>
  );
}

function GeneratorFields({
  data,
  onChange,
}: {
  data: VideoGeneratorNodeData;
  onChange: (patch: Partial<VideoGeneratorNodeData>) => void;
}) {
  return (
    <>
      <div>
        <FieldLabel>标题</FieldLabel>
        <input
          className={textInputClassName()}
          value={data.title}
          onChange={(e) => onChange({ title: e.target.value })}
        />
      </div>
      <div>
        <FieldLabel>模型（占位）</FieldLabel>
        <select
          className={textInputClassName()}
          value={data.model}
          onChange={(e) => onChange({ model: e.target.value })}
        >
          {MODEL_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <FieldLabel>比例</FieldLabel>
        <select
          className={textInputClassName()}
          value={data.aspectRatio}
          onChange={(e) => onChange({ aspectRatio: e.target.value })}
        >
          {ASPECT_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </div>
      <div>
        <FieldLabel>时长（秒）</FieldLabel>
        <input
          type="number"
          min={1}
          max={30}
          className={textInputClassName()}
          value={data.duration}
          onChange={(e) => onChange({ duration: Number(e.target.value) || 1 })}
        />
      </div>
      <div>
        <FieldLabel>分辨率</FieldLabel>
        <select
          className={textInputClassName()}
          value={data.resolution}
          onChange={(e) => onChange({ resolution: e.target.value })}
        >
          {RESOLUTION_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </div>
      <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-2 text-[11px] text-amber-200">
        生成能力将在下一阶段接入，不会伪造真实结果。
      </p>
    </>
  );
}

function OutputFields({ data }: { data: VideoOutputNodeData }) {
  return (
    <div className="space-y-2 text-xs text-zinc-300">
      <div>
        <FieldLabel>当前状态</FieldLabel>
        <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5">
          {data.status}
        </div>
      </div>
      <div>
        <FieldLabel>视频 URL</FieldLabel>
        <div className="break-all rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5">
          {data.videoUrl || "（空）"}
        </div>
      </div>
      <div>
        <FieldLabel>错误信息</FieldLabel>
        <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-rose-300">
          {data.errorMessage || "（无）"}
        </div>
      </div>
    </div>
  );
}
