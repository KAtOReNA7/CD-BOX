# CD-BOX 本机发布基线

> 状态（2026-07-12）：项目的最终运行目标是 Windows 本机单用户版本。发布是指本机生产构建与完整验收，不包含 Vercel 或其他云端部署。

## 1. 最终架构

| 模块 | 最终方案 |
| --- | --- |
| Web 应用 | 单个 Next.js 生产进程，只监听 `127.0.0.1:3000` |
| 身份边界 | `LOCAL_OWNER_MODE=true`，仅允许数值回环地址请求 |
| 数据库 | 本机 PostgreSQL 16，独立的低权限 `cd_box_app` 角色与 `cd_box` 数据库 |
| AI | 现有 OpenAI-compatible 中转站，`gpt-5.6-terra`，Chat Completions |
| 联网证据 | MusicBrainz 分页归并、NDL 国家书目硬核验、Discogs 辅助印证；精确 CAA/Discogs primary 用于真实封面 |
| 备份 | 本机 `pg_dump` custom archive、SHA-256 校验与轮换保留 |

该架构不使用 Vercel，也没有其他云托管、云数据库、外部 OAuth、付费搜索 API 或 AI 路由网关依赖。公共资料服务不收取 API 订阅费，但必须遵守其使用条款、署名、User-Agent 要求和速率限制。中转站只使用用户已有额度，不引入新的付费服务。

## 2. 首次发布

将现有中转站密钥单独复制到 Windows 剪贴板，然后在管理员终端执行：

```powershell
npm run local:bootstrap
```

Bootstrap 会安全完成以下操作：

1. 验证 PostgreSQL 实例、端口、数据目录和认证配置。
2. 创建独立数据库角色和数据库，不修改已存在的同名对象。
3. 生成数据库密码和 `AUTH_SECRET`。
4. 以受限 ACL 原子写入 Git 忽略的 `.env.local`，且不打印任何秘密。
5. 应用已提交的 Prisma migration。
6. 生成生产构建。

完成后启动：

```powershell
npm run local:start
```

浏览器只访问 <http://127.0.0.1:3000>。不得把启动主机改为 `0.0.0.0`，也不得通过端口映射向局域网或互联网开放。

## 3. 本机环境变量

手工配置时，以 `.env.example` 为模板：

```bash
DATABASE_URL=postgresql://<database-user>:<database-password>@127.0.0.1:55432/<database-name>?schema=public
LOCAL_OWNER_MODE=true
LOCAL_OWNER_BIND_HOST=127.0.0.1
NEXTAUTH_URL=http://127.0.0.1:3000
AUTH_URL=http://127.0.0.1:3000
AUTH_SECRET=<generate-a-long-random-value>

OPENAI_API_KEY=<relay-api-key>
OPENAI_BASE_URL=https://<relay-host>/v1
OPENAI_TEXT_MODEL=gpt-5.6-terra
AI_TEXT_PROTOCOL=chat-completions
AI_MAX_COMPLETION_TOKENS=16384
AI_REASONING_EFFORT=none
AI_REQUEST_TIMEOUT_MS=300000
AI_ENABLE_WEB_SEARCH=true
AI_ORGANIZE_PUBLIC_METADATA=false
AI_ENABLE_IMAGE_GENERATION=false
AI_RESPONSES_SUPPORTED=false
AI_CHAT_COMPLETIONS_SUPPORTED=true
AI_WEB_SEARCH_SUPPORTED=false

NEXT_TELEMETRY_DISABLED=1
```

真实凭据只允许存放在 `.env.local`。禁止提交、打印、复制到日志或放在命令行参数中。图片生成关闭时不配置图片模型。

## 4. AI 与联网资料门控

现有中转站已验证 Chat Completions 和 JSON 可用，Responses 正文与原生 `web_search` 不可用。因此：

- 普通文本整理直接走 Chat Completions，避免先发起无效 Responses 请求。
- `AI_ENABLE_WEB_SEARCH=true` 表示允许联网研究，而不是宣称中转站有原生搜索工具。
- 发行研究先完整读取受限范围内的 MusicBrainz 分页并按 release group 归并，再以 NDL Search 用唯一精确品番、艺人和共同日期精度绑定国家书目记录；日文/罗马字标题差异显式留给 GPT 终审，最后用 Discogs 日本 CD 版本明细作辅助印证。
- GPT-5.6 只比较已提供的 MusicBrainz、NDL 和 Discogs 证据。它可以拒绝冲突或不足，但不能浏览、补事实、改字段或绕过程序的强标识/国家书目门禁。
- 封面只允许精确发行版 CAA 或精确 Discogs release 的 `primary` 图片；数字商店图片不能证明实体版本。所有图片必须通过允许主机、HTTPS、重定向、状态码、真实文件签名、MIME、尺寸和受限响应体验证。
- 未核验、证据歧义、GPT 拒绝或无有效封面的记录自动隔离，不展示为最终结果，也不能导入。模型鉴权、额度或格式错误使任务失败，不能回退到未审计候选。

公共资料的运行要求：

- MusicBrainz 使用明确 User-Agent，并按公共服务要求串行限速。
- NDL 默认请求间隔至少 1 秒并缓存；界面必须显示 NDL Search API credit、国家书目来源与 CC BY 4.0 许可。
- Discogs 匿名请求默认间隔至少 2.5 秒，读取限速与 `Retry-After`；界面必须显示 “Data provided by Discogs.” 和非隶属声明。

重新更换中转站或模型后运行：

```powershell
npm run probe:ai
```

探针不得执行图片生成，也不得输出密钥。能力声明只能按真实探针结果修改。

## 5. 更新、备份与恢复

代码更新后先优雅停止旧服务，再安装锁定依赖并重建，最后启动新服务：

```powershell
npm run local:stop
npm run local:setup
npm run local:start
```

重要导入前后执行：

```powershell
npm run local:db:backup
```

历史库先只读预览核验计划：

```powershell
npm run library:verify
```

完成备份并审阅预览后再应用：

```powershell
npm run library:verify:apply
```

应用命令只提升唯一匹配、通过完整证据链且有真实封面的记录；冲突或未解决记录继续隔离。

恢复命令、校验规则和安全停止流程详见 [LOCAL_DEPLOYMENT.md](LOCAL_DEPLOYMENT.md)。不要使用 `prisma db push` 替代已提交 migration。

## 6. 本机发布检查

```powershell
npm ci
npm run audit:prod
npm run db:generate
npm run check
npm run build
```

最终验收顺序：

1. `127.0.0.1` owner 边界允许本机请求并拒绝非回环 Host、来源和代理头。
2. 数据库 migration、艺人创建和页面刷新持久化正常。
3. Excel 预览、重复策略、确认导入和导出正常。
4. 联网研究完整显示 MusicBrainz 归并、NDL/Discogs/GPT 核验与封面验证进度；来源、署名、拒绝摘要和原文艺人名正确。
5. 确认只有 `VERIFIED` 且有已验证封面的候选可选择、全选、导入并进入正常艺人库；候选不可编辑，字段变化必须重新搜索核验；隔离记录不可见且不可导入。
6. `library:verify` 预览不写库，`library:verify:apply` 只应用通过硬门禁的唯一历史匹配。
7. 备份、只读校验和一次测试恢复正常。
8. `Ctrl+C` 能优雅停止正在运行的本机进程。

全部通过后才将本机构建标记为可日常使用版本。
