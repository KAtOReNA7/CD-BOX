# CD-BOX Product Spec

CD-BOX 是一名实体 CD 收藏者使用的本机 WebUI。它管理一个共享的艺人/发行目录、来源链接、真实封面链接、导入历史、AI 研究任务和收藏状态。产品不面向公众，不提供注册、邀请、团队、角色或用户管理。

本文是最终产品基线；历史阶段记录不能覆盖本文。

## 产品与运行边界

- Next.js App Router、TypeScript、React、Tailwind CSS、shadcn/ui、Prisma 和 PostgreSQL。
- 单个生产进程只监听 `127.0.0.1`，默认端口 3000。
- `LOCAL_OWNER_MODE=true` 建立单 owner 边界；每个页面、Route Handler 和 Server Action 仍在服务器端检查 owner。
- 不需要外部 OAuth、云托管、云数据库、反向代理或对象存储；Vercel 不属于产品运行或发布链路。
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

正常艺人库只查询并展示 `verificationStatus=VERIFIED` 且具有已验证真实封面的发行。未核验、核验失败、证据歧义或无封面的记录可以保留在数据库审计/回填区，但不能作为最终馆藏条目显示、导出或进入收藏操作。

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
- 当前中转站不提供可用的原生 `web_search`；联网发行研究不依赖它，也不先发起无效 Responses 请求。
- 第一步完整读取受限范围内的 MusicBrainz 分页，对同一 release group 的不同国家/媒介/再版发行进行归并，并为每组选择一个规范的日本实体 CD 版本。不同 release group 即使日期相同也不能仅凭日期合并。
- 第二步以 NDL Search 国家书目作为硬核验源。规范化品番必须唯一精确，艺人和共同日期精度必须一致；标题受控等值时直接确认，日文/罗马字差异只可作为显式未决项进入 GPT 终审。结果不完整、多个记录、标识/日期冲突、缺品番或 NDL 暂时不可用都不能进入下一步。
- 第三步以 Discogs 作为辅助印证而非权威源。必须找到同一日本 CD 版本并核对标题、艺人、年份/日期、品番、国家、CD 格式与强标识；Discogs 分页不完整或版本详情不可靠时失败关闭。
- 第四步由 GPT-5.6 比较已经提供的 MusicBrainz、NDL 和 Discogs 证据。模型只能接受或拒绝，不能浏览、回忆补充、修改字段或创造来源；任何不确定或冲突都必须拒绝。即使模型返回接受，缺少确定性强标识或国家书目匹配时也会被程序拒绝。
- 公共资料服务不需要额外 API 订阅，但必须使用项目 User-Agent、串行限速、有限重试与完整性检查。NDL 默认至少间隔 1 秒并使用 24 小时缓存；Discogs 匿名请求默认至少间隔 2.5 秒，读取其限速和 `Retry-After` 响应头。
- GPT 鉴权、额度、模型或格式错误必须使核验任务失败，不能退回未审计候选，也不能伪装成搜索成功。

### 名称、封面与来源

- 艺人原文名只能来自 MusicBrainz 主名称或受控别名；MusicBrainz 的 official-homepage 关系只用于发现官网 URL，不自动把官网内容视为已核验。
- 封面依次使用精确发行版 Cover Art Archive 证据或精确 Discogs release 的 `primary` 图片；不使用 release-group 通用图、数字商店图片或生成图冒充具体实体版本封面。
- 每个封面 URL 都必须为允许主机上的 HTTPS 地址，并通过受控重定向、成功状态、真实 JPEG/PNG/WebP/GIF/BMP 文件签名、匹配 MIME、至少 64×64 的合理尺寸和受限响应体探测。无法取得真实图片的正确发行仍不进入最终结果。
- Cover Art Archive 或 Discogs 的封面来源单独持久化；封面不能替代实体版本元数据证据，也不能独立提高发行置信度。
- AI 生成图片不得作为真实 CD 封面。
- 界面持续展示 “This application uses the NDL Search API.”、NDL 书目元数据与 CC BY 4.0 许可信息，以及 “Data provided by Discogs.” 和 Discogs 非隶属声明。

### 质量门控

- 缺品番、日期、MusicBrainz release/release-group 链接、唯一且标识绑定的 NDL 国家书目记录、Discogs 精确版本印证、GPT 接受或真实封面中的任何一项，均直接排除。
- 原版 CD 范围下的 LP、黑胶、卡带、DVD、Blu-ray、明确再版/重制及无法确认原版身份的版本默认排除。
- 只有通过全部硬门禁的结果才能标记为 `HIGH`/`VERIFIED` 并显示给用户；未通过条目只计入核验摘要，不展示详情供用户判断。
- 最终核验候选不可在导入前编辑；任何字段变化都必须重新搜索和核验。导入 API 会再次校验所选 ID、`VERIFIED` 状态、证据时效、目标艺人和实时封面。
- AI 结果永不直接写入正式发行表；owner 只能从已自动核验的最终结果中选择并确认导入。
- 同一艺人的重复 `title + catalogNumber` 不覆盖人工整理数据。

### 历史库隔离与回填

- schema migration 后，既有记录默认处于未核验隔离状态；正常艺人库不显示无 `VERIFIED` 状态或无有效封面的记录。
- `npm run library:verify` 只读生成逐条回填预览，不写数据库。
- owner 先备份并审阅预览，再运行 `npm run library:verify:apply`。只有唯一匹配且通过同一证据链和封面硬门禁的记录会更新为 `VERIFIED`。
- 应用模式保留人工备注和已有非空封面；封面冲突或无法唯一匹配的记录不修改并继续隔离。

## 粘贴资料整理

Owner 可以粘贴官网、厂牌、零售商、数据库、CSV 或表格文本。该模式不联网，也不得声称执行过搜索。

- 来源只能来自粘贴文本中的显式 URL 或用户单独输入的来源 URL。
- 封面只能保留用户显式提供的封面 URL。
- 缺失字段保持 `null`，不得猜品番、日期、封面或来源。
- 与联网研究复用同一解析、质量门控和导入路径；粘贴资料不能自行获得 `VERIFIED` 身份。

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
4. 公共资料研究、进度、来源、原文名、封面、最终候选选择和导入。
5. 收藏状态、筛选、批量操作和来源管理。
6. 数据库备份、校验与测试恢复。
7. 生产构建、优雅停止和重新启动。

完整运维步骤见 `docs/LOCAL_DEPLOYMENT.md`；当前完成度见 `docs/PROGRESS.md`。
