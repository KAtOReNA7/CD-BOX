# CD-BOX 本机部署与运维

CD-BOX 的个人使用版本完全运行在本机，不依赖 Vercel、其他云托管、付费搜索 API、云数据库或外部登录。应用只监听 `127.0.0.1`，不会向局域网或互联网开放。

> 本手册说明当前可构建检查点的实际安装、启动、备份和恢复行为。当前发行研究仍保留旧 `ORIGINAL_CD`、封面硬门禁及 300 秒提供商超时；这些是迁移期实现，不是冻结目标。目标规则见 [PRODUCT_SPEC.md](PRODUCT_SPEC.md)，未完成差距见 [PROGRESS.md](PROGRESS.md)。

## 运行结构

- Next.js 生产服务器：`http://127.0.0.1:3000`
- PostgreSQL：本机 PostgreSQL 16
- AI：通过 `.env.local` 中配置的 OpenAI-compatible 中转站
- 联网发行证据：MusicBrainz、NDL Search、Discogs 与 Cover Art Archive 公共接口；无需新增付费订阅
- 数据备份：`var/backups/postgres/`

真实密钥和数据库密码只能保存在 Git 忽略的 `.env.local` 中。仓库里的 `.env.example` 只包含占位符。

Bootstrap 使用当前中转站实际开放的 `gpt-5.6-terra`（GPT-5.6）。真实探针确认 Chat Completions 和 JSON 可用，而 Responses 会完成但不返回正文、原生 `web_search` 不可用，因此本机实际配置固定为 `AI_TEXT_PROTOCOL=chat-completions`，并写入 `AI_RESPONSES_SUPPORTED=false`、`AI_CHAT_COMPLETIONS_SUPPORTED=true`、`AI_WEB_SEARCH_SUPPORTED=false`，避免每次先产生一次无效且可能计费的 Responses 请求。联网发行流程不依赖原生搜索：作品与实体版必须由强权威来源和一个相互独立、绑定同一精确实体的来源共同支持，但不硬性规定每条记录都必须同时命中 NDL 与 Discogs。GPT-5.6 只比较所给证据并可拒绝，不能创造事实或绕过确定性门禁。默认不启用额外推理强度（`AI_REASONING_EFFORT=none`），单次请求超时为 300 秒；能力未经探针验证前不能自行声明为可用。

## 联网资料服务规则

- MusicBrainz：使用明确 User-Agent，串行请求并遵守至少约 1 请求/秒的公共限速；分页结果按 release group 归并。只有绑定精确 release 的完整实体信息才可充当实体佐证，源端不完整时不得假装完整。
- NDL Search：精确匹配的国家书目可以作为日本实体 CD 的强权威来源，但不是每条记录唯一允许的权威来源。应用显示 “This application uses the NDL Search API.”，书目元数据按 CC BY 4.0 署名；请求默认串行、至少间隔 1 秒、有限重试并缓存 24 小时。
- Discogs：精确 release 可以作为独立实体佐证，作品级、搜索结果级或只匹配年份的数据不能替代实体版身份。应用显示 “Data provided by Discogs.” 及非隶属声明；匿名请求默认串行、至少间隔 2.5 秒，并遵守响应中的限速与 `Retry-After`。分页不完整时不返回已核验候选。
- Cover Art Archive / Discogs：只接受精确实体 release 的 CAA front 或 Discogs `primary`。每张封面必须通过 HTTPS 主机白名单、受控重定向、真实文件签名、MIME、尺寸与响应体上限检查。
- 未核验、证据冲突、歧义或无有效封面的条目不会出现在正常艺人库或最终搜索结果中，也不能导入。

NDL 与 Discogs 的署名在应用全局页脚和联网研究结果区持续可见。不要删除、隐藏或改写这些声明。

## 首次全自动初始化

全新 Windows 电脑必须先由用户人工安装并确认以下依赖；Bootstrap 不会安装或重新配置这些软件：

- Git for Windows，确保 PowerShell 可以运行 `git`。
- Node.js `24.16.0`，附带 npm `11.x`；项目锁定 npm `11.13.0`。
- PostgreSQL Windows x64 `16`；推荐服务名 `postgresql-x64-16`、端口 `55432`，服务状态必须为 `Running`。

可在普通 PowerShell 中检查：

```powershell
git --version
node --version
npm --version
Get-Service postgresql-x64-16
Get-NetTCPConnection -LocalPort 55432 -State Listen
```

当前发布版本不在远端默认分支。必须显式克隆 `codex/production-mvp`：

```powershell
git clone --branch codex/production-mvp --single-branch https://github.com/KAtOReNA7/CD-BOX.git
Set-Location .\CD-BOX
```

然后只将中转站 `sk-...` 密钥本身放入 Windows 剪贴板，不要把密钥粘贴到命令、文档或聊天。从管理员 PowerShell 进入仓库并执行：

```powershell
npm run local:bootstrap
```

该命令不会读取、输出或更改已有 `.env.local`；发现已有文件时会立即停止。Bootstrap 没有替换环境文件或跳过应用安装的旁路；已有安装必须走下方“已有安装的代码更新”流程。

正常首次初始化会：

1. 验证管理员权限、PostgreSQL 16 服务、数据目录、实际端口和 `pg_hba.conf` 路径。
2. 验证剪贴板只包含一个非空的 `sk-` 样式密钥，但绝不打印它。
3. 生成强随机数据库密码和 `AUTH_SECRET`。
4. 原子备份 `pg_hba.conf`，只在最前面短暂加入 `hostnossl postgres postgres 127.0.0.1/32 trust`。
5. reload 后创建无超级用户权限的 `cd_box_app` 角色和全新的 `cd_box` 数据库；如果任一对象已经存在则拒绝修改。
6. 在 `finally` 中恢复字节级一致的原文件、再次 reload，并进行 SHA-256 校验。
7. 以仅当前用户、SYSTEM 和 Administrators 可读的 ACL 原子写入 `.env.local`。
8. 自动运行 `npm ci`、生成 Prisma Client、执行仓库内已提交的 migration，并生成 Next.js 生产构建。

脚本不创建临时 SQL 文件；包含数据库密码的 SQL 只通过标准输入发送给本机 `psql`。如果数据库创建已经开始后发生异常，脚本不会删除角色或数据库，并会保留一个受保护且被 Git 忽略的 recovery 环境文件。正常成功或创建前失败时会清理全部临时文件。

## 已有安装的代码更新

`local:bootstrap` 只用于全新的首次安装。已有安装更新前，先确认没有进行中的搜索、导入、回填、备份或恢复任务，再严格按以下顺序执行：

```powershell
npm run local:db:backup
npm run local:stop
git pull --ff-only origin codex/production-mvp
npm run local:setup
npm run local:start
```

其中 `local:setup` 会以非交互方式完成以下工作：

1. 每次都运行 `npm ci`，按 lockfile 重新安装锁定版本依赖。
2. 确认目标 PostgreSQL 数据库存在。
3. 生成 Prisma Client 并应用仓库内已提交的 migration。
4. 生成 Next.js 生产构建。

脚本从进程环境读取 `DATABASE_URL`。npm 命令会通过 Node.js 的 `--env-file-if-exists=.env.local` 安全载入本机配置；脚本不会输出连接串或密码。

## 启动与安全停止

```powershell
npm run local:start
```

启动脚本实际执行 `next start -H 127.0.0.1 -p 3000`，并强制启用本机 owner 模式和回环地址。浏览器唯一入口是 <http://127.0.0.1:3000>，不要改用其他主机或端口。

`npm start` 委托给同一个 `local:start` 入口，`npm run dev` 也显式绑定 `127.0.0.1:3000`。本机启动入口拒绝任何改端口参数，不要绕过脚本改用其他绑定。

前台运行时，优先在运行窗口按一次 `Ctrl+C`，然后等待 Next.js 和封面重试 worker 一起退出，最多预留 30 秒。后台运行且确认没有进行中的搜索、导入、回填、备份或恢复时，可执行 `npm run local:stop`；它会核对进程确实属于当前仓库，然后同时停止 Next.js 和该仓库 PID 文件绑定的封面重试 worker。端口或 PID 属于其他程序时会拒绝操作。不要在 AI 任务运行时直接关闭终端、使用任务管理器结束进程或强制关机。

## 数据库备份

```powershell
npm run local:db:backup
```

默认策略：

- 使用 PostgreSQL custom archive 格式和压缩。
- 同时生成 SHA-256 校验文件。
- 默认保留最近 14 份，并清理超过 30 天的旧备份。
- 只会删除备份目录内符合 `cd-box-*.dump` 的文件，不会递归删除目录。

可覆盖保留策略和目标目录：

```powershell
npm run local:db:backup -- -BackupDirectory "D:\CD-BOX-Backups" -RetentionDays 60 -RetentionCount 30
```

脚本会自动寻找 PATH 或标准 PostgreSQL Windows 安装目录中的 `pg_dump.exe`。

## 校验和恢复

先做不连接数据库的归档校验：

```powershell
npm run local:db:restore -- -BackupFile "var\backups\postgres\cd-box-example.dump" -ValidateOnly
```

执行恢复前必须先优雅停止 CD-BOX，并明确写出目标数据库名：

```powershell
npm run local:db:restore -- -BackupFile "var\backups\postgres\cd-box-example.dump" -ConfirmDatabaseName "cd_box"
```

恢复脚本会校验归档及 SHA-256（存在校验文件时），确认 `http://127.0.0.1:3000` 未被监听，并在覆盖数据前自动再做一份安全备份。恢复使用单事务；出现错误时 PostgreSQL 会回滚本次恢复。

## 切换已确认可用的模型

仅在当前中转站已经确认开放目标模型、且地址与协议能力均未变化时，先确认没有运行任务并停止 CD-BOX，再执行：

```powershell
npm run local:stop
npm run local:set-model -- gpt-5.6-terra
npm run local:start
```

`local:set-model` 只原位更新受 ACL 保护的 `.env.local`，不会输出环境文件或密钥。中转站地址、协议或能力发生变化时不能只改模型名，必须重新完成提供商探针和能力核验。

## 日常维护

- 每次重要导入或大批量编辑前执行一次备份。
- 至少将一份备份复制到本机之外的存储设备。
- 代码更新按“确认无运行任务 → `local:db:backup` → `local:stop` → `git pull --ff-only origin codex/production-mvp` → `local:setup` → `local:start`”执行；`local:setup` 每次都会按 lockfile 重装依赖。不要使用 `prisma db push` 替代 migration。
- schema 或核验规则更新后，先运行 `npm run library:verify` 查看历史库回填预览；确认并备份后才运行 `npm run library:verify:apply`。预览命令不写库，应用命令也不会提升无封面或未通过证据链的记录。
- 本机启动无需反向代理；只有将来决定向其他设备开放时，才需要重新设计认证、TLS 和网络边界。

## 发行任务重物化与封面重试

这两个入口只供维护既有发行研究任务使用，不属于首次安装或日常启动步骤。先确认没有运行中的搜索、导入、回填、备份或恢复任务，再显式列出允许处理的任务 ID：

```powershell
# 离线重建既有任务的结果和审计；会写数据库，但不调用 AI、公共网络或远程封面
npm run discography:rematerialize -- --task-ids=TASK_ID_1,TASK_ID_2

# 只访问已持久化、通过身份审计的精确实体封面；不调用 GPT
npm run discography:retry-covers -- --task-ids=TASK_ID_1,TASK_ID_2 --max-batches=4
```

两个入口都使用与搜索和总账持久化相同的任务级 PostgreSQL advisory lock。封面 worker 会在锁内为一批候选写入带随机 token 的限时 claim lease，网络工作结束后重新验证 claim 所有权再持久化；租约失效或并发状态变化时失败关闭，不能覆盖另一个执行者的结果。

`discography:rematerialize` 只接受显式白名单中的成功任务，并使用已保存的请求、候选、证据和审计按当前选择规则重建结果；重复执行应保持一致。它允许自动隔离两类可由既有数据确定的旧 `VERIFIED` 缺陷：实体版封面日期不匹配时降为 `PENDING_COVER`；缺少精确实体发行日或 CD 格式时降为 `PENDING_EVIDENCE`。

重物化另有两个不会改变证据结论的严格旧格式归一化入口。旧 MusicBrainz 发布记录只有在 verification 数组恰好多出一个规范 release-group URL，且该 URL、精确 `workId`、候选 release-group 来源及 PASS ledger 中的 release 完整互相绑定时才临时兼容；输出会清理 verification 数组中的旧冗余 URL，并再次按当前格式严格校验。松田圣子只允许 5 个固定候选在候选键、作品/版次 ID、完整旧/目标来源数组 SHA-256、官方来源、MusicBrainz 实体、PASS ledger 与封面绑定全部精确命中时，将已验证结果的来源数组同步到 `sourceCandidate.candidate.sources`；观察、冲突、身份和证据结论不变。

这些入口不是按艺人名或相似来源猜测修复。任何近似 URL、额外或缺失来源、指纹或身份漂移、损坏审计/证据状态、`CHECKING` 候选都会停止整项重物化；任务已导入、候选已绑定收藏 release，或松田圣子快照曾归一化后再次分歧时也会失败关闭并要求人工审计。该命令不会重新搜索，也不会消耗中转站额度。

`discography:retry-covers` 只重查已绑定且通过身份审计的精确 MusicBrainz release、Discogs release、Apple `EDITION` collection 或既有官方封面。Apple collection ID 必须与持久化候选完整身份重新核对；只有 URL 的 Apple 封面和 `WORK` 级 Apple 匹配不会进入重试。它不重新执行 NDL、目录发现、Discogs 搜索、Apple 搜索或 AI 判断；已导入任务、已关联艺人库或已绑定 release 的候选不能被 claim。公共封面服务超时或暂不可用时，作品继续保留为 `PENDING_COVER`，不会发布、删除或错误提升为 `VERIFIED`。

离线回放会分别报告目录守恒和可发布覆盖：`canonicalAccountingPassed` 可以在仍有明确 `PENDING_COVER` 时通过，`publishableBenchmarkPassed` 只有全部应发布作品均具备有效真实封面时才会通过。运行上述维护命令期间应等待自然结束；不要强杀进程或关机。
