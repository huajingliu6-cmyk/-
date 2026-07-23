# AI 视频工作流编辑器

基于 **Next.js + React Flow（@xyflow/react）** 的节点工作流编辑器。

> 本地 `data/workflows/*.json` 与 `data/assets/` 仅用于开发阶段，不是生产数据库 / 对象存储方案。

## 启动

```bash
npm install
npm run dev
```

打开 http://localhost:3000

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Next.js App Router + Tailwind CSS + @xyflow/react |
| 状态 | zustand |
| 校验 | zod |
| 后端 | Next.js API Routes `/api/workflow`、`/api/assets` |
| 存储 | 本地 JSON + 本地文件（开发用） |

## 本地素材存储（开发专用）

- 上传接口：`POST /api/assets`（multipart/form-data）
- 读取接口：`GET /api/assets/[assetId]`
- 文件目录：`data/assets/`（已加入 `.gitignore`）
- WorkflowDocument **只保存** `assetId` / `assetUrl` / 文件元数据，**不保存** base64 或 `blob:` URL

### 生产环境风险

- **Vercel 等无状态文件系统不适合作为生产素材存储**（部署实例可写磁盘不可靠、易丢失）
- 生产阶段应替换为 **Supabase Storage**（或同类对象存储）并使用签名 URL
- 当前方案仅供本机开发与验收

## 旧 tldraw 数据

已停用并标记为 legacy，见 `data/canvases-legacy/`。未经确认不要删除。
