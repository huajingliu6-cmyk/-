# AI 视频工作流编辑器

基于 **Next.js + React Flow（@xyflow/react）** 的节点工作流编辑器。

> 本地 `data/workflows/*.json` 仅用于开发阶段，不是生产数据库方案。

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
| 后端 | Next.js API Routes `/api/workflow` |
| 存储 | 本地 JSON（开发用） |

## 旧 tldraw 数据

已停用并标记为 legacy，见 `data/canvases-legacy/`。未经确认不要删除。
