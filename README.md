# AI 视频创作工作台

基于 **Next.js + React Flow（@xyflow/react）** 的资产驱动式 AI 视频画布。

> 本地 `data/workflows/*.json` 与 `data/assets/` 仅用于开发阶段。  
> **Vercel 文件系统不适合生产素材存储；生产阶段应替换为 Supabase Storage（或同类对象存储）。**

## 启动

```bash
npm install
npm run dev
```

打开 http://localhost:3000

## 工作台结构

| 区域 | 说明 |
|------|------|
| 顶部工具栏 | 项目名、保存状态、布局模式、Fit View |
| 左侧资产库 | 素材分类、搜索、拖拽、删除未引用素材 |
| 中间画布 | React Flow + 常驻快速创建栏 |
| 右侧属性面板 | 节点/镜头参数 |
| 底部分镜栏 | VideoShot 镜头列表与排序 |

布局偏好（布局模式 / 快速创建栏位置 / 密度）保存在 **localStorage**，不写入 WorkflowDocument。

## 本地素材

- `POST /api/assets` · `GET /api/assets/[id]` · `DELETE /api/assets/[id]`
- 磁盘目录：`data/assets/`（UUID 文件名，已 gitignore）
- WorkflowDocument 只保存 `AssetRecord` 元数据与节点中的 `assetId` 引用
- **禁止** base64 / `blob:` URL 持久化

## 角色生成 API

选中角色 / 场景 / 视频节点后，节点下方会出现提示栏，可请求生成：

- `POST /api/generate/character-image` — 角色外貌
- `POST /api/generate/character-voice` — 角色声音
- `POST /api/generate/scene-image` — 场景画面
- `POST /api/generate/video-shot` — 视频镜头

默认 `mock`：写入本地演示素材，并在响应 `notice` 中标明「非真实模型」。

接入真实服务时，在环境变量中配置：

```bash
CHARACTER_IMAGE_PROVIDER=http
CHARACTER_IMAGE_API_URL=https://your-image-model/v1/generate
CHARACTER_VOICE_PROVIDER=http
CHARACTER_VOICE_API_URL=https://your-voice-model/v1/generate
SCENE_IMAGE_PROVIDER=http
SCENE_IMAGE_API_URL=https://your-scene-model/v1/generate
VIDEO_SHOT_PROVIDER=http
VIDEO_SHOT_API_URL=https://your-video-model/v1/generate
CHARACTER_GEN_API_KEY=optional-bearer-token
```

HTTP 模式请求体：`{ prompt, characterName|sceneName|…, kind }`。  
期望响应：二进制媒体，或 JSON `{ base64, mimeType }` / `{ url }`。

## 旧 tldraw 数据

见 `data/canvases-legacy/`。未经确认不要删除。
