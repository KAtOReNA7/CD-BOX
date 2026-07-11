# CD-BOX Product Spec

CD-BOX 是一名实体 CD 收藏者使用的本机 WebUI。它管理一个共享的艺人/发行目录、来源链接、真实封面链接、导入历史、AI 研究任务和收藏状态。产品不面向公众，不提供注册、邀请、团队、角色或用户管理。

本文是最终产品基线；历史阶段记录不能覆盖本文。

## 产品与运行边界

- Next.js App Router、TypeScript、React、Tailwind CSS、shadcn/ui、Prisma 和 PostgreSQL。
- 单个生产进程只监听 `127.0.0.1`，默认端口 3000。
- `LOCAL_OWNER_MODE=true` 建立单 owner 边界；每个页面、Route Handler 和 Server Action 仍在服务器端检查 owner。
- 不需要外部 OAuth、云托管、云数据库、反向代理或对象存储。
- 艺人与发行形成一个共享目录；用户关联表保留用于收藏状态、数据完整性和未来兼容，但不构成多用户产品。
- 真实秘密只保存在 Git 忽略且 ACL 受限的 `.env.local`。
- 本机 PostgreSQL 是唯一运行数据库；使用已提交 migration，不使用 `prisma db push` 代替发布迁移。

## 页面

- `/`
- `/dashboard`
- `/artists/new`
- `/artists/[id]`
- `/releases/[id]`
- `/import`
- `/ai-search`
- `/settings`

## 艺人库与发行表

艺人详情页是主要收藏工作区。默认表格按以下顺序显示：

1. 收藏状态
2. 分类
3. 标题
4. 原始发行日期
5. 原始品番
6. 格式
7. 来源数量
8. 备注
9. 封面

`coverImageUrl` 是最后一个可见列。来源 URL 单独保存在 `ReleaseSource`，并在发行详情页显示。

艺人库支持：

- 收藏状态 `OWNED`、`NOT_OWNED`、`WANTED`、`EXCLUDED`、`PENDING_REVIEW`。
- 1–5 优先级。
- 快速编辑状态、备注和封面 URL。
- 完整发行元数据编辑与来源增删。
- 批量更新、缺口视图、筛选、收藏统计和元数据完整度。
- 导出全部或当前筛选结果到 Excel。

## Excel 导入

`/import` 支持 `.xlsx` 上传、预览、重复检测和明确确认后写库。上传本身不能修改数据库。

支持的逻辑工作表：

- `A_OriginalAlbumOriginalCD`
- `B_SingleOriginalCD`
- `C_BestLiveRemix`

等价日文表名同样支持；说明、口径、术语等非数据工作表跳过。

字段规则：

- 封面图映射到 `Release.coverImageUrl`。
- 来源 URL 映射到 `ReleaseSource.url`。
- 两列同时存在时分别保留。
- 日期按工作簿本地年月日解析，避免时区漂移。

重复规则：

1. 优先匹配 `artistId + originalCatalogNo`。
2. 品番为空时匹配 `artistId + title + originalReleaseDate + format`。
3. 预览只标记重复，不写数据库。
4. 确认阶段支持跳过、更新现有或创建新记录。

## AI 与联网发行研究

所有 AI 文本调用统一通过 `src/lib/ai/client.ts`。最终配置使用现有 OpenAI-compatible 中转站的 `gpt-5.6-terra` Chat Completions；不经过额外 AI 路由服务。

`/ai-search` 有两个模式：

1. 联网研究
2. 粘贴资料整理

联网研究输入：艺人名、国家/地区、收藏范围、是否排除再版、是否包含合作名义，以及是否包含 Live/Remix/Best。

### 联网研究策略

- `AI_ENABLE_WEB_SEARCH=true` 表示用户允许联网研究。
- 当某个中转站明确支持 Responses 与真实 `web_search` 时，可使用原生工具调用，并要求响应中存在真实搜索调用。
- 当前已验证中转站不支持该能力，因此直接查询 MusicBrainz 与 Cover Art Archive 公共资料源，不先发起无效 Responses 请求。
- 公共资料服务不需要额外 API 订阅，但调用必须遵守其公开规则与速率限制。
- 公共资料默认按来源确定性映射，不调用模型；GPT-5.6 只用于整理用户粘贴的非结构化资料。
- 当公共源无法确认再版状态且用户要求排除再版时，候选必须标为待核对，不能显示为可安全导入。
- 模型输出新增或改变日期、品番、厂牌、格式、条码、封面、来源、再版、重制或原始发行日期时，整个整理结果被拒绝并使用确定性映射。
- 公共源只提供某一具体发行日期时写入 `releaseDate`，不得猜测 `originalReleaseDate`。
- MusicBrainz 未明确给出再版/重制状态时保持 `null`，不得根据标题或日期推断。
- AI 鉴权、额度或模型错误必须在警告/任务错误中可见。只有公共源已经产生确定性候选时，任务才能以公共资料模式成功。

### 名称、封面与来源

- 艺人原文名只能来自 MusicBrainz 名称/别名或严格匹配的 Apple Music 元数据。
- Apple Music 只有在至少两个不同专辑建立唯一主艺人证据后，才能补全艺人原文名。
- 每个 Apple 封面还必须匹配同一艺人的唯一精确标题与年份；现有封面不覆盖，歧义结果保持为空。
- Apple 封面保存单独的来源链接，但不能替代实体版本证据，也不能提高发行置信度。
- AI 生成图片不得作为真实 CD 封面。

### 质量门控

- 缺品番最多为 `MEDIUM`，并标记待核对。
- 缺来源强制为 `LOW`，并标记待核对。
- 仅 wiki 来源最多为 `MEDIUM`。
- 原版 CD 范围下的 LP、黑胶、卡带、DVD、Blu-ray 等默认排除。
- 明确再版且用户要求排除再版时默认排除。
- 完整、有真实来源、品番、日期、厂牌和 CD 格式的候选可以为 `HIGH`。
- 默认只选择 `HIGH`、有品番、有来源且未默认排除的候选。
- AI 结果永不直接写入正式发行表；必须由 owner 预览、编辑、选择并确认导入。
- 同一艺人的重复 `title + catalogNumber` 不覆盖人工整理数据。

## 粘贴资料整理

Owner 可以粘贴官网、厂牌、零售商、数据库、CSV 或表格文本。该模式不联网，也不得声称执行过搜索。

- 来源只能来自粘贴文本中的显式 URL 或用户单独输入的来源 URL。
- 封面只能保留用户显式提供的封面 URL。
- 缺失字段保持 `null`，不得猜品番、日期、封面或来源。
- 与联网研究复用同一解析、质量门控、候选编辑和导入路径。

## 持久化与任务状态

- 搜索任务保存在 `AiSearchTask`。
- `rawResult` 保存研究模式、进度阶段、公共证据、模型响应快照和脱敏错误。
- `parsedResult` 保存通过校验的候选。
- 任务阶段必须反映真实工作：等待、资料查询、证据校验、名称/封面补全和保存。
- 失败任务保存可操作的脱敏错误，不得记录 API 密钥或数据库密码。

## 无新增付费依赖原则

- 优先使用项目已有依赖和 Codex 已安装能力完成开发、安装与验收。
- 新工具先检查是否可本机运行、是否开源或免订阅，以及是否要求信用卡。
- 不引入会自动续费、按请求收费的搜索服务、云数据库或托管平台。
- Codex 浏览器/计算机控制只用于开发和验收，不能作为 CD-BOX 关闭 Codex 后的运行时后端。

## 本机发布与验收

发布命令：

```powershell
npm ci
npm run audit:prod
npm run db:generate
npm run check
npm run build
```

最终验收必须在 `127.0.0.1` 完成：

1. 本机 owner 边界和非回环请求拒绝。
2. PostgreSQL migration、艺人创建和数据持久化。
3. Excel 预览、重复策略、确认导入与导出。
4. 公共资料研究、进度、来源、原文名、封面、候选编辑和导入。
5. 收藏状态、筛选、批量操作和来源管理。
6. 数据库备份、校验与测试恢复。
7. 生产构建、优雅停止和重新启动。

完整运维步骤见 `docs/LOCAL_DEPLOYMENT.md`；当前完成度见 `docs/PROGRESS.md`。
