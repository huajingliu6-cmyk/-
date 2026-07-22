# 无限画布

Next.js 16 + React 19 + Tailwind CSS 4 + tldraw ^5.2.5

## 安装与启动

在项目目录 `infinite-canvas` 中打开终端，执行：

```bash
# 1. 安装依赖
npm install

# 若 tldraw 下载很慢，可用国内镜像：
# npm install --registry=https://registry.npmmirror.com

# 2. 启动开发服务器
npm run dev
```

然后浏览器打开：http://localhost:3000

## 功能说明

- 满屏无限画布（缩放 / 平移 / 画图形）
- 停止操作 1 秒后自动保存到 `data/canvases/default.json`
- 顶部状态条显示「正在保存...」或「已保存」
- 刷新页面后从后端恢复画布
