# Lumina Story

**Lumina Story** 是基于 **Next.js + React Flow（@xyflow/react）** 的资产驱动式 AI 故事与视频创作平台。

> 本地 `data/` 文件实现仅用于开发兼容和遗留数据导入。  
> 生产架构固定为 **Next.js Web/BFF → Go API → PostgreSQL + 独立 Blobstore**；Web 不直连数据库，也不依赖本地业务磁盘。SSDB 仅用于隔离的开发测试缓存，不进入生产部署。

## 启动

```bash
npm install
npm run dev
```

打开 http://localhost:3000

## Dev Quickstart

1. 配置 `.env.local`（可参考 `.env.example`）：至少设置 `AUTH_SECRET`。
2. 系统管理员不会在启动或登录时自动创建。先用已有账号登录，或通过产品/脚本创建普通用户后，用本机 CLI 提升：
   `npm run auth:grant-system-admin -- --username <用户名>`。
3. **Mock 视频**：将自有 MP4 放到 `data/mock/mock-video.mp4`（详见 [docs/mock-video-setup.md](docs/mock-video-setup.md)）。未配置时画布会提示，Mock 生成会失败。
4. 打开工作台 `/` 或 `/workflow`：编排节点 → 在视频镜头上「检查生成输入」走 Mock 流程。
5. 默认 `VIDEO_PROVIDER=mock`、`ALLOW_PAID_GENERATION=false`，不会调用阿里云或产生费用。

本机环回演练（仍不自动开付费）：`npm run dev:local-paid-test`

## 工作台结构

| 区域 | 说明 |
|------|------|
| 顶部工具栏 | 项目名、保存状态、布局模式、Fit View |
| 左侧资产库 | 素材分类、搜索、拖拽、删除未引用素材 |
| 中间画布 | React Flow + 常驻快速创建栏 |
| 右侧属性面板 | 节点/镜头参数 |
| 底部分镜栏 | VideoShot 镜头列表与排序 |

布局偏好（布局模式 / 快速创建栏位置 / 密度）保存在 **内存会话态**（刷新后恢复默认），不写入 WorkflowDocument，也不使用 localStorage 保存业务数据。

## 素材存储

- `POST /api/assets` · `GET /api/assets/[id]` · `DELETE /api/assets/[id]`
- 生产环境经 Go API 写入独立 Blobstore，PostgreSQL 保存元数据。
- `data/assets/` 只保留为本地开发兼容目录（UUID 文件名，已 gitignore）。
- WorkflowDocument 只保存 `AssetRecord` 元数据与节点中的 `assetId` 引用
- **禁止** base64 / `blob:` URL 持久化

## 生产部署

- 统一编排：`deploy/compose.remote.yml`
- Web 容器为只读文件系统，只能通过内网访问 Go API。
- Go API 连接 PostgreSQL 与独立 Blobstore；只有 Web 发布主机端口。
- `npm run architecture:check` 用于阻止 Web 直连存储、生产 SSDB 和不安全 Provider 默认值回归。
- `npm run build` 会在生成 standalone 后移除被兼容代码追踪到的 `data/` 与遗留 Prisma 文件，并执行产物门禁。

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
