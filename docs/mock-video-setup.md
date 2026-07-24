# Mock 视频本地配置

Mock 模式**只用于开发测试**，不会调用阿里云，也不会产生费用。

## 为何需要本地 MP4

旧版 Mock 曾写入约 **98 B** 的伪 MP4（仅含残缺 `ftyp` / `moov` / `mdat` 字符串，**没有可解码视频轨道和媒体帧**）。浏览器会一直停在「正在读取视频…」，`loadedmetadata` 不会成功。

现在 Mock **必须**使用你有使用权的真实短 MP4，经与正式转存相同的链路复制，并明确标记为演示结果。

## 准备步骤

1. 准备一个自己有权使用的短 MP4（建议几秒、体积较小；**推荐 H.264** MP4，便于浏览器解码）。
2. 复制到仓库内相对路径：

```text
data/mock/mock-video.mp4
```

3. （可选）用环境变量指定其它**相对项目根目录**的路径，或本机路径（勿把私人路径写进文档或提交到 Git）：

```text
MOCK_VIDEO_FILE=data/mock/mock-video.mp4
```

4. **不要**把该 MP4 提交到 Git（`data/mock/**` 已 gitignore，仅保留 `.gitkeep` / README）。
5. **不要**使用敏感或私人视频作为团队共享素材。
6. 该方案**仅用于开发环境**；生产环境不要依赖此 Mock 文件。

## 未配置时的行为

若文件不存在或验证失败：

- 任务进入 **`failed`**
- 错误码：`MOCK_VIDEO_NOT_CONFIGURED` 或 `MOCK_VIDEO_INVALID`
- 中文提示类似：「尚未配置可播放的本地 Mock 视频，请将一个自有 MP4 放入 data/mock/mock-video.mp4。」
- **不会**再生成 98 B 占位文件
- **不会**回退 PNG 或伪装 `completed`

## 如何确认播放链路

配置好后，在工作台对镜头运行 Mock：

1. 浏览器 `<video>` 能播放，且出现 `loadedmetadata`（可读时长与宽高）
2. Network：`/api/assets/{assetId}?projectId=...`（或带 `generationId`）
   - 无 Range → **200**
   - 带 `Range: bytes=...` → **206**
3. metadata **PATCH** `/api/generations/{id}/metadata` 在实测字段有效时返回 200（写回 `actualWidth` / `actualHeight` / `actualDurationSeconds` / `metadataSource`）
4. 使用下载链接取得的 MP4 可在本机播放器打开
5. UI 明确显示：「Mock 演示视频，不是真实 AI 生成结果」

服务端仅做**基础结构验证**（存在、扩展名、非图片伪装、含 `ftyp` 与 `moov`/`mdat`），**不声称已证明浏览器可解码**；最终以人工播放为准。

## 安全提醒

- 不要把密钥、密码、`.env.local` 内容或私人文件路径写进本仓库文档
- 不要提交任何 `*.mp4` / `*.webm`、运行时任务 JSON 或用户上传素材
