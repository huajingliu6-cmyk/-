# 参考素材选择（阶段 3C-A）

本文说明视频生成前参考素材的候选收集、自动/手动选择、发送顺序与服务端校验。不含密钥、用户素材或本机绝对路径。

## 数据模型

`VideoShotNode.data`：

| 字段 | 含义 |
|------|------|
| `referenceSelectionMode` | `"auto"` \| `"manual"` |
| `selectedReferenceAssetIds` | 手动模式下的选择与发送顺序 |

WorkflowDocument **version = 4**。

## 候选素材来源

纯函数 `collectReferenceMediaCandidates` 只读取：

1. 通过边连接到当前 VideoShot **输入端口（in）** 的节点
2. 镜头自身的 `sourceVideoAssetId`（参考视频）

不进入普通候选池：

- 未连接节点
- `ImageNode.referenceType === "startFrame"`（首帧独立处理）

进入候选：

- 角色当前形象：主图 + `references` / `referenceAssetIds`（去重保序）
- 场景：主图 + 视角 + `referenceAssetIds`
- 普通 ImageNode / PropNode
- 参考视频（模型支持时 eligible；不支持则保留来源但不可选）

相同 `assetId` 只占一个名额；去重保留第一次出现。

## 自动模式（auto）

- **不以** `selectedReferenceAssetIds` 为权威
- eligible 数量 ≤ `capability.maxReferenceMedia`：全选，顺序=候选稳定顺序
- eligible 数量 > 上限：**不**截取前 N 项；`requiresManualSelection=true`；错误码 `REFERENCE_SELECTION_REQUIRED`

## 手动模式（manual）

- `selectedReferenceAssetIds` 是选择与发送顺序的**唯一**来源
- **空数组**表示明确选择零项，**不得**解释为 auto
- 非法：重复 ID、池外 ID、不可用候选、超过上限、与首帧 ID 冲突
- 任一非法时不静默删除后继续，返回结构化错误

## 空手动选择语义

- 文生视频合法时：可不发送参考素材
- 参考生视频且规则要求至少一张图/视频时：由后续 `validateGenerationSettings` 拒绝

## 发送顺序

1. 首帧（若有）单独置于 media 列表前端，不参与「图 N」编号
2. 普通参考：手动=选择数组顺序；自动=候选稳定顺序
3. Provider payload **不再**按角色/场景/图片重分组打乱顺序
4. Prompt 中「图 N / 视频 N」按媒体类型各自递增，且与 payload 中对应项一致

## 首帧规则

- 优先 `startFrameAssetId`，否则连接的 startFrame ImageNode
- 不占用 `maxReferenceMedia`
- 单独受 `maxFirstFrames` 约束
- 多个首帧来源：结构化错误，不静默取第一个
- 首帧存在时 `requestedAspectRatio = null`（阶段 3B 对照语义不变）

## 服务端验证

权威来源：最新 WorkflowDocument 中 VideoShot 节点的 mode + selected IDs。

- API 可选附带客户端快照；必须与节点保存值顺序一致，否则 `STALE_REFERENCE_SELECTION`
- 池外 / 不可用 ID：`INVALID_REFERENCE_SELECTION` / `REFERENCE_MEDIA_NOT_AVAILABLE`
- 模型上限只来自 `ModelCapability.maxReferenceMedia` / `maxFirstFrames`
- Zod 仅做结构校验；HTTP Payload 安全上限为独立常量 `MAX_REFERENCE_SELECTION_IDS_IN_REQUEST`（≠ 模型上限）
- 禁止 `slice(0, limit)` 静默截断
- **禁止**用硬编码 fallback `5` 作为业务上限：未加载 `ModelCapability` 时返回 `MODEL_CAPABILITY_NOT_LOADED`，客户端禁用生成

## 结构化错误码

| code | 含义 |
|------|------|
| `REFERENCE_SELECTION_REQUIRED` | 自动模式超限，需手动选择 |
| `INVALID_REFERENCE_SELECTION` | 选择失效（池外/重复/首帧冲突等） |
| `REFERENCE_MEDIA_LIMIT_EXCEEDED` | 手动选择超过模型上限 |
| `REFERENCE_MEDIA_NOT_AVAILABLE` | 已选素材不可用 |
| `STALE_REFERENCE_SELECTION` | 客户端快照与工作流不一致 |
| `MODEL_CAPABILITY_NOT_LOADED` | 未提供 ModelCapability，禁止用硬编码上限继续 |
| `TOO_MANY_FIRST_FRAMES` | 首帧超过 `maxFirstFrames` |

## 当前权限限制（非生产级多用户隔离）

当前可验证：

- 素材是否属于当前 `WorkflowDocument.projectId`
- 候选是否来自连接到当前镜头的节点
- AssetRecord / MIME / 临时 URL

**尚未**实现：完整 userId RLS、跨用户对象所有权、生产对象存储 ACL。本地 `data/` 仅适合开发。

## 下一阶段

阶段 **3C-B**：`ReferenceMediaSelectionDrawer` 与确认界面勾选 UI（本阶段仅预留 Store action：`setReferenceSelectionMode` / `setSelectedReferenceAssetIds`）。
