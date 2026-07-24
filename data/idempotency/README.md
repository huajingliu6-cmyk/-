# 本地幂等记录目录

本目录由 `FileGenerationIdempotencyStore` 写入开发态持久幂等记录。

- 仅适合**单机器共享文件系统**本地开发。
- **不**支持多实例 / 多机器并发（生产需 Postgres 或 Redis 实现同一接口）。
- 记录不含 prompt 全文、素材、base64、API Key、签名 URL。
- 运行时 `*.json` **不会**提交到 Git。

详见：`docs/generation-idempotency.md`。
