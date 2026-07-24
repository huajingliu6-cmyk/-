# 本机一次性付费测试 Guard

此目录保存跨 `npm run dev` 重启可恢复的 Guard 状态 JSON。

- **仅单机器本机开发保护**，不是生产预算 / 多实例系统。
- 运行时 `*.json` 已被 gitignore，**禁止提交**。
- 文件不得包含：API Key、测试 Token、Prompt 全文、base64、视频/签名 URL、本机绝对路径。
- Windows 写入使用同目录临时文件 + rename；目标已存在时为 unlink→rename（短暂缺失窗口），**不是**数据库事务。

归档：将 Guard 标记为 `consumed` 后可删除对应 JSON，或保留供审计（仍勿提交）。
