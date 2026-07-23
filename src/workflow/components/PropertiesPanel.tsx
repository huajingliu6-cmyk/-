"use client";

import type { ReactNode } from "react";
import { useWorkflowStore } from "@/workflow/store";
import type {
  AudioReferenceNodeData,
  CharacterReferenceNodeData,
  DirectorNodeData,
  ImageReferenceNodeData,
  SceneReferenceNodeData,
  TextNodeData,
  VideoGeneratorNodeData,
  VideoOutputNodeData,
  WorkflowNode,
} from "@/workflow/types";
import { AssetUploadControls } from "./AssetUploadControls";

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
            使用顶部快速创建栏添加角色、场景、导演台与素材节点。当前
            <span className="text-amber-300">尚未接入真实生成</span>。
          </p>
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
        {selected.type === "character" && (
          <CharacterFields
            data={selected.data as CharacterReferenceNodeData}
            onChange={(patch) => updateNodeData(selected.id, patch)}
          />
        )}
        {selected.type === "scene" && (
          <SceneFields
            data={selected.data as SceneReferenceNodeData}
            onChange={(patch) => updateNodeData(selected.id, patch)}
          />
        )}
        {selected.type === "director" && (
          <DirectorFields
            data={selected.data as DirectorNodeData}
            onChange={(patch) => updateNodeData(selected.id, patch)}
          />
        )}
        {selected.type === "videoGenerator" && (
          <GeneratorFields
            data={selected.data as VideoGeneratorNodeData}
            onChange={(patch) => updateNodeData(selected.id, patch)}
          />
        )}
        {selected.type === "image" && (
          <ImageFields
            data={selected.data as ImageReferenceNodeData}
            onChange={(patch) => updateNodeData(selected.id, patch)}
          />
        )}
        {selected.type === "text" && (
          <TextFields
            data={selected.data as TextNodeData}
            onChange={(patch) => updateNodeData(selected.id, patch)}
          />
        )}
        {selected.type === "audio" && (
          <AudioFields
            data={selected.data as AudioReferenceNodeData}
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
  return "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-zinc-500";
}

function CharacterFields({
  data,
  onChange,
}: {
  data: CharacterReferenceNodeData;
  onChange: (patch: Partial<CharacterReferenceNodeData>) => void;
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
        <FieldLabel>角色名</FieldLabel>
        <input
          className={textInputClassName()}
          value={data.characterName}
          onChange={(e) => onChange({ characterName: e.target.value })}
        />
      </div>
      <div>
        <FieldLabel>描述</FieldLabel>
        <textarea
          className={`${textInputClassName()} min-h-20`}
          value={data.description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </div>
      <div>
        <FieldLabel>角色参考图</FieldLabel>
        <AssetUploadControls
          kind="image"
          accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
          assetUrl={data.assetUrl}
          fileName={data.fileName}
          uploadStatus={data.uploadStatus}
          errorMessage={data.errorMessage}
          onChange={onChange}
        />
      </div>
    </>
  );
}

function SceneFields({
  data,
  onChange,
}: {
  data: SceneReferenceNodeData;
  onChange: (patch: Partial<SceneReferenceNodeData>) => void;
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
        <FieldLabel>场景名</FieldLabel>
        <input
          className={textInputClassName()}
          value={data.sceneName}
          onChange={(e) => onChange({ sceneName: e.target.value })}
        />
      </div>
      <div>
        <FieldLabel>描述</FieldLabel>
        <textarea
          className={`${textInputClassName()} min-h-20`}
          value={data.description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </div>
      <div>
        <FieldLabel>场景参考图</FieldLabel>
        <AssetUploadControls
          kind="image"
          accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
          assetUrl={data.assetUrl}
          fileName={data.fileName}
          uploadStatus={data.uploadStatus}
          errorMessage={data.errorMessage}
          onChange={onChange}
        />
      </div>
    </>
  );
}

function DirectorFields({
  data,
  onChange,
}: {
  data: DirectorNodeData;
  onChange: (patch: Partial<DirectorNodeData>) => void;
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
        <FieldLabel>景别</FieldLabel>
        <select
          className={textInputClassName()}
          value={data.shotSize}
          onChange={(e) =>
            onChange({
              shotSize: e.target.value as DirectorNodeData["shotSize"],
            })
          }
        >
          <option value="extremeWide">大远景</option>
          <option value="wide">远景</option>
          <option value="medium">中景</option>
          <option value="closeUp">近景</option>
          <option value="extremeCloseUp">特写</option>
        </select>
      </div>
      <div>
        <FieldLabel>机位角度</FieldLabel>
        <select
          className={textInputClassName()}
          value={data.cameraAngle}
          onChange={(e) =>
            onChange({
              cameraAngle: e.target.value as DirectorNodeData["cameraAngle"],
            })
          }
        >
          <option value="eyeLevel">平视</option>
          <option value="lowAngle">仰拍</option>
          <option value="highAngle">俯拍</option>
          <option value="topDown">顶拍</option>
          <option value="dutchAngle">荷兰角</option>
        </select>
      </div>
      <div>
        <FieldLabel>运镜</FieldLabel>
        <select
          className={textInputClassName()}
          value={data.cameraMovement}
          onChange={(e) =>
            onChange({
              cameraMovement: e.target
                .value as DirectorNodeData["cameraMovement"],
            })
          }
        >
          <option value="static">静止</option>
          <option value="pan">横摇</option>
          <option value="tilt">俯仰</option>
          <option value="dollyIn">推近</option>
          <option value="dollyOut">拉远</option>
          <option value="tracking">跟踪</option>
          <option value="orbit">环绕</option>
          <option value="handheld">手持</option>
        </select>
      </div>
      <div>
        <FieldLabel>镜头</FieldLabel>
        <select
          className={textInputClassName()}
          value={data.lens}
          onChange={(e) =>
            onChange({ lens: e.target.value as DirectorNodeData["lens"] })
          }
        >
          <option value="wide">广角</option>
          <option value="standard">标准</option>
          <option value="telephoto">长焦</option>
        </select>
      </div>
      <div>
        <FieldLabel>运动速度</FieldLabel>
        <select
          className={textInputClassName()}
          value={data.movementSpeed}
          onChange={(e) =>
            onChange({
              movementSpeed: e.target
                .value as DirectorNodeData["movementSpeed"],
            })
          }
        >
          <option value="slow">慢</option>
          <option value="medium">中</option>
          <option value="fast">快</option>
        </select>
      </div>
      <div>
        <FieldLabel>补充说明</FieldLabel>
        <textarea
          className={`${textInputClassName()} min-h-20`}
          value={data.description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </div>
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
        <FieldLabel>生成描述</FieldLabel>
        <textarea
          className={`${textInputClassName()} min-h-24`}
          value={data.generationInstruction}
          onChange={(e) =>
            onChange({ generationInstruction: e.target.value })
          }
        />
      </div>
      <div>
        <FieldLabel>模型</FieldLabel>
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
        <FieldLabel>画幅</FieldLabel>
        <select
          className={textInputClassName()}
          value={data.aspectRatio}
          onChange={(e) => onChange({ aspectRatio: e.target.value })}
        >
          {ASPECT_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {v}
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
          {RESOLUTION_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}

function ImageFields({
  data,
  onChange,
}: {
  data: ImageReferenceNodeData;
  onChange: (patch: Partial<ImageReferenceNodeData>) => void;
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
        <FieldLabel>参考类型</FieldLabel>
        <select
          className={textInputClassName()}
          value={data.referenceType}
          onChange={(e) =>
            onChange({
              referenceType: e.target
                .value as ImageReferenceNodeData["referenceType"],
            })
          }
        >
          <option value="startFrame">首帧</option>
          <option value="endFrame">尾帧</option>
          <option value="style">风格</option>
          <option value="composition">构图</option>
        </select>
      </div>
      <div>
        <FieldLabel>图片</FieldLabel>
        <AssetUploadControls
          kind="image"
          accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
          assetUrl={data.assetUrl}
          fileName={data.fileName}
          uploadStatus={data.uploadStatus}
          errorMessage={data.errorMessage}
          onChange={onChange}
        />
      </div>
    </>
  );
}

function TextFields({
  data,
  onChange,
}: {
  data: TextNodeData;
  onChange: (patch: Partial<TextNodeData>) => void;
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
        <FieldLabel>文本类型</FieldLabel>
        <select
          className={textInputClassName()}
          value={data.textType}
          onChange={(e) =>
            onChange({
              textType: e.target.value as TextNodeData["textType"],
            })
          }
        >
          <option value="script">剧本</option>
          <option value="dialogue">对白</option>
          <option value="narration">旁白</option>
          <option value="subtitle">字幕</option>
          <option value="instruction">补充生成描述</option>
        </select>
      </div>
      <div>
        <FieldLabel>内容</FieldLabel>
        <textarea
          className={`${textInputClassName()} min-h-32`}
          value={data.content}
          onChange={(e) => onChange({ content: e.target.value })}
        />
      </div>
      {data.legacyNegativePrompt && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-2 text-[11px] text-zinc-500">
          旧负向提示词：{data.legacyNegativePrompt}
        </div>
      )}
    </>
  );
}

function AudioFields({
  data,
  onChange,
}: {
  data: AudioReferenceNodeData;
  onChange: (patch: Partial<AudioReferenceNodeData>) => void;
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
        <FieldLabel>音频文件</FieldLabel>
        <AssetUploadControls
          kind="audio"
          accept="audio/mpeg,audio/wav,audio/mp4,audio/x-m4a,audio/m4a,.mp3,.wav,.m4a"
          assetUrl={data.assetUrl}
          fileName={data.fileName}
          uploadStatus={data.uploadStatus}
          errorMessage={data.errorMessage}
          onChange={(patch) =>
            onChange({
              ...patch,
              duration: patch.duration ?? data.duration,
            })
          }
        />
      </div>
    </>
  );
}

function OutputFields({ data }: { data: VideoOutputNodeData }) {
  return (
    <div className="space-y-2 text-zinc-400">
      <div>标题：{data.title}</div>
      <div>状态：{data.status}</div>
      <div className="text-amber-300">本阶段不伪造生成视频</div>
    </div>
  );
}
