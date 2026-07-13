# CD-BOX

CD-BOX 是一套面向个人使用的官方音乐与音视频发行收藏资料库。它在 Windows 本机运行，用于管理艺人、作品、发行版本、来源、封面、收藏状态、Excel 导入和 AI 辅助资料研究。

本项目不依赖 Vercel、云数据库、付费搜索 API 或外部登录。应用只监听 `127.0.0.1`，同一局域网内的其他设备也无法访问。

> **当前状态（2026-07-13）**：`codex/production-mvp` 是已经提供本机安装入口、用于人工测试的开发中发布候选，不是下述冻结产品规则已经全部实现的最终版本。本机部署、owner 边界、艺人库、Excel 导入/导出、现有发行研究台账、进度持久化和维护脚本已经存在；“全部官方发行”、作品/版本完整嵌套、封面与 `VERIFIED` 解耦、新时限及八艺人 gold-reference 验收仍在收敛。不要把现有四艺人 `ORIGINAL_CD` 回归结果解释成最终产品已经完成。

## 冻结产品范围与实现状态

以下内容是后续开发和验收必须遵守的最终产品目标。当前代码与目标不一致时，以本节作为目标，但必须在完成实现和验证前继续标记为待办，不能仅修改文档后宣称完成。

### 冻结目标

- **收录范围**：收录目标艺人的全部官方发行，不限于单曲和原创专辑，也不限于 CD。范围包括实体与数字音视频介质，以及 EP/mini album、精选、现场、混音、原声、致敬、合辑、套装、影像及其他官方类别；也包括官方 promo、非卖品、自费、会场和歌迷会发行。非官方发行、盗版和卖家自行组合的商品不收录。
- **数据粒度**：顶层是音乐或音视频作品，下面嵌套该作品的官方发行版本。分类服从艺人、厂牌或发行方的官方分类；不得按尺寸、时长、曲目数或 Discogs format 文本猜测作品类别。再版、地区版和不同介质属于版本，不得被误算成新的顶层作品。
- **证据规则**：一个与具体作品或版本精确绑定的一级权威来源可以确认事实；否则必须有两个相互独立的可靠来源，并且至少一个是实体级来源。AI 只能比较已经取得的证据、处理跨文字标题或实质冲突，不能凭记忆补事实、创造来源或绕过确定性检查。
- **封面规则**：`VERIFIED` 与封面状态解耦。证据已经确认但暂时无封面的条目仍可展示、选择和导入，并明确标记缺封面；封面可以绑定精确版本，也可以是已确认属于正确作品的 work-level 图片。允许来源包括官方页面、Cover Art Archive/Discogs、正规零售商和二手市场；零售商或二手市场不能单独证明发行是官方的。禁止把 AI 生成图当成真实封面。
- **来源调度**：先按来源对当前事实是否适用、结果是否正确排序，再按速度和近期成功率选择；慢源或连续故障源必须有限重试并熔断，不能让一个来源阻塞整项研究。
- **交互与任务**：多语言艺人名和标题必须保留；结果支持全选；重复导入必须幂等；所有长任务必须显示阶段、数量和进度，并按检查点恢复，不能因重试重新消耗已经完成的工作。
- **时间上限**：单次 AI 请求最多 75 秒，单艺人的 AI 审核阶段最多 10 分钟，一次完整搜索最多 15 分钟。超时后保存已完成检查点和明确待办，不得无限等待。
- **最终验收**：固定验收艺人为中山美穂、松田聖子、中森明菜、山口百恵、坂本龍一、邓丽君、王菲和 The Beatles。冻结范围内 gold reference 的作品与版本召回必须达到 100%，错误标为 `VERIFIED` 的数量必须为 0，封面自动命中率目标至少为 80%。
- **发布含义**：软件可以在仍有 `PENDING_EVIDENCE`、来源缺口或缺封面待办时发布使用；前提是所有已发现项目均显式守恒、状态和原因可见，并且不宣称目录已经完整。软件发布状态与某位艺人的资料完成度必须分别报告。

### 当前已经实现

- Windows 本机、单 owner、PostgreSQL 16、`127.0.0.1:3000` 固定入口以及无外部登录的运行边界。
- 艺人创建、收藏状态、筛选、批量操作、Excel 预览/导入/导出，以及 AI 搜索任务的持久化进度和结果台账。
- `canonicalWorks`、待证据、待封面、明确排除和已核验结果的守恒报告；维护 runner 能聚合报告违规，而不是首错终止。
- `workId` / `editionId`、实体日期与原始作品日期分离、任务级锁、检查点、有限重试和封面 worker 的基础设施。
- 现有 OpenAI-compatible 中转站的 `gpt-5.6-terra` Chat Completions 接入；确定性字段由程序检查，模型只接收已提供证据。

### 当前仍在收敛的差距

| 冻结目标 | 当前真实实现 | 状态 |
| --- | --- | --- |
| 全部官方类别、介质、promo 与非卖品 | 默认研究、fixture 和最终 runner 仍以日本实体 `ORIGINAL_CD`、单曲和原创专辑为主；部分 EP、mini album、promo、影像和非 CD 会被排除 | 未完成 |
| 作品为顶层、所有官方版本嵌套 | 已有 `workId` / `editionId` 和部分按作品归并，但结果与艺人库仍以选定发行行展示，尚未形成完整的作品/版本两层体验 | 部分完成 |
| 一级精确来源可确认，否则两独立来源 | 当前发布门禁通常要求强权威加独立精确实体佐证，部分路径比冻结目标更严格；统一来源角色矩阵尚未完成 | 未完成 |
| `VERIFIED` 与封面解耦 | 当前正常艺人库、选择和导入仍把有效封面作为硬门禁 | 未完成 |
| exact-edition 或正确 work-level 封面均可 | 当前已存在部分官方、CAA、Discogs 和 Apple 的版本/作品级处理，但 provider 规则与导入门禁尚未按冻结目标统一，正规零售和二手市场角色也未完整落地 | 部分完成 |
| 75 秒 / 10 分钟 / 15 分钟上限与慢源熔断 | 当前部署配置仍使用 300 秒单请求超时，虽已有有限重试、缓存和部分截止时间，但新的分层时限、动态排序与统一熔断尚未完成 | 未完成 |
| 多语言、全选、幂等导入和可恢复进度 | 已有艺人别名、原文名、全选、重复检测、任务进度和部分检查点；全部官方版本的端到端幂等导入及恢复验收尚未完成 | 部分完成 |
| 资料有待办时仍可发布软件 | 当前 final suite 仍会因待证据或待封面导致整体发布指标失败，尚未把软件可用性与艺人资料完成度彻底拆开 | 未完成 |
| 八艺人 100% gold reference、0 false verified、封面命中率 ≥80% | 当前 manifest 有八位旧范围诊断 fixture，但 final suite 只覆盖中山美穂、松田聖子、中森明菜和山口百恵四位 `ORIGINAL_CD` 艺人；冻结名单中的坂本龍一和王菲等新范围基准尚未完成 | 未完成 |

截至本次同步，`npm run check`（791/791 项测试、TypeScript、ESLint）、`npm run build`、`npm run audit:prod`（0 个已知生产依赖漏洞）和 Prisma Client 生成已经通过。本次没有运行公共预检、真实 AI、本机端到端流程或 migration deploy，因此这些项目仍不能记录为通过。详细工程快照见 [docs/PROGRESS.md](docs/PROGRESS.md)；其中的四艺人数字只证明旧范围的回归和幂等性，不是新范围的完成率。

## 新电脑从 GitHub 安装

当前开发中发布候选位于 `codex/production-mvp` 分支。远端默认分支仍是 `main`，因此克隆时不能省略 `--branch codex/production-mvp`，否则可能得到旧版本。

### 1. 需要人工完成的准备

先在新电脑上安装并确认以下软件：

| 项目 | 要求 | 是否由 CD-BOX 自动完成 |
| --- | --- | --- |
| Git for Windows | 能在 PowerShell 中运行 `git` | 否，必须人工安装 |
| Node.js | `24.16.0` | 否，必须人工安装 |
| npm | `11.x`；项目锁定版本为 `11.13.0` | 通常随 Node.js 安装，需人工核对 |
| PostgreSQL | Windows x64 版 `16` | 否，必须人工安装 |
| 中转站 API 密钥 | 与项目当前 OpenAI-compatible 中转站匹配的 `sk-...` 密钥 | 否，首次初始化时从剪贴板安全读取 |

安装 PostgreSQL 16 时，推荐使用项目默认值：

- Windows 服务名：`postgresql-x64-16`
- 端口：`55432`
- 服务状态：`Running`
- PostgreSQL 安装器要求设置的 `postgres` 密码由用户自行保管；不要写入仓库或聊天
- pgAdmin 和 Stack Builder 不是 CD-BOX 的必需组件

在普通 PowerShell 中核对版本和服务：

```powershell
git --version
node --version
npm --version
Get-Service postgresql-x64-16
Get-NetTCPConnection -LocalPort 55432 -State Listen
```

`node --version` 应显示 `v24.16.0`，`npm --version` 应显示 `11.x`，PostgreSQL 服务应为 `Running`，端口 `55432` 应处于监听状态。

### 2. 下载指定发布分支

以下命令会将代码下载到 `C:\Projects\CD-BOX`；如需其他目录，只替换前两行路径：

```powershell
New-Item -ItemType Directory -Force C:\Projects | Out-Null
Set-Location C:\Projects
git clone --branch codex/production-mvp --single-branch https://github.com/KAtOReNA7/CD-BOX.git
Set-Location .\CD-BOX
git status --short --branch
```

最后一条命令应显示当前分支为 `codex/production-mvp`。如果 GitHub 要求身份验证，只通过 Git Credential Manager 或浏览器使用仓库所有者账号登录；不要把 GitHub Token 写进命令、README 或 `.env.local`。

### 3. 首次自动初始化

只把中转站 API 密钥本身复制到 Windows 剪贴板，不要附带说明文字、引号或换行，也不要把密钥粘贴到终端。

然后从开始菜单以“管理员身份运行”Windows PowerShell，进入项目目录并执行：

```powershell
Set-Location C:\Projects\CD-BOX
npm run local:bootstrap
```

`local:bootstrap` 会自动完成：

1. 核对管理员权限、PostgreSQL 16 安装、服务、数据目录、服务名和端口。
2. 从剪贴板读取密钥，但不打印密钥，也不把密钥放在进程命令行中。
3. 创建无超级用户权限的 `cd_box_app` 角色和 `cd_box` 数据库。
4. 生成随机数据库密码和 `AUTH_SECRET`。
5. 原子写入被 Git 忽略且仅当前用户、SYSTEM 和 Administrators 可读的 `.env.local`。
6. 执行 `npm ci`、生成 Prisma Client、应用仓库内已提交的 migration，并生成 Next.js 生产构建。

它不会自动安装 Git、Node.js 或 PostgreSQL。为了保护已有数据，发现 `.env.local`、`cd_box_app` 角色或 `cd_box` 数据库已经存在时也会拒绝覆盖；这条命令只用于全新的首次安装。

如果新电脑已经使用其他 PostgreSQL 端口或服务名，可显式传入实际值；只有通过脚本的本机 PostgreSQL 安全检查时才会继续：

```powershell
npm run local:bootstrap -- -PostgresPort 5432 -PostgresServiceName "postgresql-x64-16"
```

### 4. 启动并使用

首次初始化完成后，可关闭管理员终端，打开普通 PowerShell：

```powershell
Set-Location C:\Projects\CD-BOX
npm run local:start
```

在浏览器中只打开：

<http://127.0.0.1:3000>

不要改用 `localhost`、局域网 IP 或公网地址。CD-BOX 的本机 owner 模式会在合法的回环请求中自动创建唯一 owner，无需注册、无需 GitHub OAuth，也没有登录表单需要填写。

`local:start` 会以前台方式启动 Next.js 生产服务器，并同时启动封面重试 worker。正常停止时，在运行窗口按一次 `Ctrl+C` 并等待两者退出；也可在另一个终端、确认没有搜索、导入、回填、备份或恢复任务后执行：

```powershell
npm run local:stop
```

`local:stop` 会核对进程属于当前仓库，然后同时停止 Next.js 和该仓库 PID 文件绑定的封面重试 worker；端口或 PID 属于其他程序时会拒绝操作。不要在搜索、导入、回填、备份或数据库恢复期间强制结束进程或关机。

`npm start` 委托给同一个 `local:start` 入口，`npm run dev` 也固定绑定 `127.0.0.1:3000`。本机启动入口不接受改端口参数；不要绕过脚本启动到其他主机或端口。

## 哪些步骤需要人工，哪些已经自动化

需要人工完成：

- 安装 Git、Node.js 24.16.0、npm 11.x 和 PostgreSQL 16。
- 在 PostgreSQL 安装器中选择端口，确认 Windows 服务正在运行。
- 从 GitHub 克隆指定发布分支。
- 将中转站密钥单独复制到剪贴板，并在管理员 PowerShell 中启动首次初始化。
- 在浏览器中进行最终功能确认；迁移旧电脑时手工复制数据库备份文件。

脚本自动完成：

- 生成和保护数据库密码、认证密钥与 `.env.local`。
- 创建最小权限数据库角色和数据库。
- 安装 lockfile 中的依赖、生成 Prisma Client、执行 migration 和 production build。
- 强制本机 owner 模式、`127.0.0.1` 绑定和 Next.js telemetry 关闭。
- 启动/停止应用与封面重试 worker，创建带 SHA-256 校验的数据库备份。

## 日后更新

先确认没有进行中的搜索、导入、回填、备份或恢复任务。每次更新前按固定顺序备份数据库并停止应用：

```powershell
Set-Location C:\Projects\CD-BOX
npm run local:db:backup
npm run local:stop
git pull --ff-only origin codex/production-mvp
npm run local:setup
npm run local:start
```

`local:setup` 会重新执行锁定版本依赖安装、Prisma Client 生成、已提交 migration 和生产构建。数据库结构只能通过仓库内 migration 更新，不要使用 `prisma db push`。

## 把旧电脑的收藏迁移到新电脑

GitHub 只保存代码，不保存本机收藏数据库、`.env.local`、API 密钥、日志或 `var/` 下的备份。仅执行 `git clone` 不会带回旧电脑中的艺人库。

在旧电脑上先执行：

```powershell
npm run local:db:backup
```

将 `var\backups\postgres\` 中最新的 `.dump` 和对应 `.sha256` 一起复制到 U 盘或其他受保护位置。不要通过 GitHub、Issue 或聊天传输 `.env.local`。

新电脑完成“首次自动初始化”后，确保 CD-BOX 已停止，再执行：

```powershell
Set-Location C:\Projects\CD-BOX
npm run local:db:restore -- -BackupFile "E:\CD-BOX-Backup\cd-box-example.dump" -ConfirmDatabaseName "cd_box"
npm run local:start
```

把示例备份路径替换为真实绝对路径。恢复脚本会检查归档，并在对应 `.sha256` 存在时校验 SHA-256；在覆盖前还会创建一份安全备份，并使用单事务恢复。更完整的备份、恢复和异常处理说明见 [docs/LOCAL_DEPLOYMENT.md](docs/LOCAL_DEPLOYMENT.md)。

## 配置与密钥安全

首次初始化会在 `.env.local` 中配置以下类别的变量：

- 本机数据库：`DATABASE_URL`
- 本机唯一 owner：`LOCAL_OWNER_MODE`、`LOCAL_OWNER_BIND_HOST`
- 本机 URL：`NEXTAUTH_URL`、`AUTH_URL`
- 随机认证密钥：`AUTH_SECRET`
- OpenAI-compatible 中转站：`OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_TEXT_MODEL` 及能力声明
- 隐私设置：`NEXT_TELEMETRY_DISABLED`

`.env.example` 只包含占位符。真实 `.env.local` 已被 Git 忽略，不能提交、截图、打印，不能粘贴到 README、Issue、聊天或测试日志。如果更换中转站地址、模型或协议，先在本机修改配置并执行可选探针验证，不要凭猜测更改能力声明。

仅切换已由当前中转站确认存在的文本模型时，先停止 CD-BOX，再使用不会打印 `.env.local` 内容的命令，例如当前发布模型：

```powershell
npm run local:stop
npm run local:set-model -- gpt-5.6-terra
npm run local:start
```

中转站地址、协议或能力发生变化时不能只改模型名，必须重新完成提供商探针和能力核验。

## 当前可测试的功能与现行限制

- `/artists/new`：新建并关注艺人。
- `/ai-search`：按现有 `ORIGINAL_CD` 管线联网研究发行资料，展示阶段进度、证据和过滤原因。
- `/import`：Excel 预览、重复项处理、全选和确认导入。
- `/artists/[id]`：管理收藏状态、备注、筛选、批量操作和 Excel 导出。

当前实现仍采用旧的 fail-closed 发布门禁：通常需要强权威来源和相互独立、绑定精确实体的佐证，并且正常艺人库、候选选择和导入仍要求 `VERIFIED` 条目具有已验证封面。这种行为可以继续用于旧范围回归和人工测试，但它不是上文冻结目标的最终行为；后续必须改为“一级精确来源可确认，否则两个独立可靠来源且至少一个实体级”，并将封面状态从 `VERIFIED`、显示、选择和导入资格中解耦。

当前中转站实际开放的 `gpt-5.6-terra`（GPT-5.6）只比较已经提供的证据并可以返回未决或拒绝，不能创建发行事实或绕过程序门禁。MusicBrainz、NDL Search、Discogs 和 Cover Art Archive 使用公共接口，不需要新增付费订阅；正规零售与二手市场来源尚未按冻结规则完整接入。应用必须保留 NDL Search API / CC BY 4.0 署名、`Data provided by Discogs` 和非隶属声明。

## 验证命令与额度说明

以下命令不调用真实 AI，适合代码更新后的本机校验：

```powershell
npm run check
npm run build
```

`npm run check` 依次执行 TypeScript 类型检查、全部单元测试和 ESLint。这两个命令不会调用真实 AI；`local:bootstrap` 与 `local:setup` 已经执行 production build，因此普通使用者无需重复构建。它们通过只代表代码门禁通过，不代表“全部官方发行”范围或八艺人 gold reference 已经验收完成。

以下命令会联网。带 AI 的命令会使用用户现有中转站额度，只能在中转站、模型、协议或证据审计逻辑发生变化且确有必要时运行；不得把真实 AI 套件当作定位普通代码错误的循环测试：

```powershell
# 检查中转站协议和模型能力；可能消耗少量额度
npm run probe:ai

# 公共元数据真实冒烟，不调用 GPT
npm run smoke:verified-discography

# 旧范围的真实 GPT 证据冒烟；会消耗额度，仅用于维护者验收
npm run smoke:verified-discography:ai
```

`npm run probe:ai` 和 `npm run smoke:verified-discography:ai` 都可能产生真实计费请求。运行前必须先在进度说明中明确告知；失败时先用离线 fixture 和保存的检查点修复，不要无修改地反复重跑。

当前大型艺人目录 runner 的维护顺序仍是“离线回放 → 公共资料预检 → 最终 AI”：

```powershell
# 只读既有完成任务；不会调用 AI、公共网络或重新下载封面
npm run discography:replay -- --final-suite --replay-tasks=<slug=taskId,...>

# 只读取 var 中按艺人保存的已通过检查点；缺失时直接失败，不联网
npm run discography:preflight:offline

# 访问公共元数据和封面，但不调用 GPT；每位艺人通过后保存检查点
npm run discography:preflight

# 当前旧范围最终门禁；调用真实中转站并可能消耗额度
npm run discography:acceptance:ai
```

当前 `discography:acceptance:ai` 仍绑定四艺人 `ORIGINAL_CD` final suite，不是冻结 PRD 的八艺人全部官方发行验收。只有离线回放、公共预检、`npm run check`、`npm run build`、migration 和本机运行验收都通过后才可运行；同一提交最多从头完整运行一次，失败后必须使用已保存的 `--resume-tasks` 检查点，只续跑未完成艺人。八艺人 gold reference、0 false verified、封面自动命中率和新时间上限对应的 runner 完成前，仓库没有任何命令可以据此宣称最终 PRD 已验收通过。

`--resume-tasks=<slug=taskId,...>` 可以复用已经完成的艺人任务，只运行缺失成员。公共预检检查点会原子写入 Git 忽略的 `var/`。离线回放默认只把聚合报告写到终端，不会自动保存日志；需要留档时应显式重定向到 `var/`，例如：

```powershell
npm run discography:replay -- --final-suite --replay-tasks=<slug=taskId,...> *> var\discography-replay.jsonl
```

不得将检查点、任务结果、日志或其他本机数据提交到 GitHub。

现有回放报告会分别给出 `canonicalAccountingPassed` 和 `publishableBenchmarkPassed`。前者用于检查旧范围中的权威作品是否都有明确去向；后者仍把封面作为发布硬门禁，因此只能作为旧实现的回归指标。冻结目标允许证据已确认但缺封面的 `VERIFIED` 条目显示、选择和导入，后续 runner 必须把“证据真实性”“封面完成度”和“软件发布状态”拆成独立指标。

维护者如需维护既有旧范围任务，或在公共封面服务恢复后只重试已绑定实体，可在确认没有运行中的搜索、导入、回填、备份或恢复任务后使用：

```powershell
# 离线重建既有任务的结果和审计；会写数据库，但不调用 AI、公共网络或远程封面
npm run discography:rematerialize -- --task-ids=TASK_ID_1,TASK_ID_2

# 只访问已持久化、通过身份审计的精确实体封面；不调用 GPT
npm run discography:retry-covers -- --task-ids=TASK_ID_1,TASK_ID_2 --max-batches=4
```

> 以下重物化、隔离和封面重试语义描述的是当前旧范围实现，用于安全维护既有任务；它们不会自动扩展为全部官方发行，也不会完成封面与 `VERIFIED` 解耦。

两个命令都要求显式任务 ID 白名单，并以同一个任务级 PostgreSQL advisory lock 与搜索、总账写入串行化。封面 worker 还会为每批候选写入带 token 的限时 claim lease，落库前再次确认 claim 所有权；租约失效或被并发修改时会失败关闭，不能覆盖其他任务结果。

重物化可重复执行并保持结果一致。它允许自动隔离两类可由既有数据确定的旧 `VERIFIED` 缺陷：实体版封面日期不匹配时降为 `PENDING_COVER`；缺少精确实体发行日或 CD 格式时降为 `PENDING_EVIDENCE`。此外只有两个不会改变证据结论的旧格式归一化入口：其一，旧 MusicBrainz 发布记录的 verification 数组必须恰好多出一个规范 release-group URL，且该 URL、`workId`、候选中的 release-group 来源和 PASS ledger 中的精确 release 必须完全互相绑定；重建会去掉 verification 数组中的旧冗余 URL，并立即按当前规则再次严格校验。其二，仅松田圣子的 5 个固定候选可以在候选键、作品/版次 ID、完整旧/目标来源数组 SHA-256、官方来源、MusicBrainz 实体、PASS ledger 和封面绑定全部精确命中时，把已验证结果中的来源数组同步到 `sourceCandidate.candidate.sources`；观察、冲突、身份和证据结论保持不变。

以上兼容入口都不是通用修复。任何近似 URL、额外或缺失来源、指纹或身份漂移、损坏审计/证据状态、`CHECKING` 候选都会停止整项重物化；任务已经导入、候选已经绑定收藏 release，或松田圣子快照曾归一化后再次出现差异时也会失败关闭并要求人工审计。

封面重试不会重新做目录发现、NDL 查询、Discogs 搜索、Apple 搜索或 AI 判断。Apple 只允许使用已持久化且重新核对成功的精确 `EDITION` collection ID；只有 URL 的 Apple 封面和 `WORK` 级 Apple 匹配不会进入重试。MusicBrainz/CAA 与 Discogs 也只重查已绑定的精确 release，官方封面只重新验证既有绑定。已导入任务、已关联艺人库或已绑定 release 的候选不能被 worker claim。公共封面暂不可用时，正确结果是继续保留 `PENDING_COVER`，而不是删除条目或将其提升为 `VERIFIED`。运行期间应等待自然结束，不要强杀进程或关机。

详细的本机运维、安全停止、备份和恢复手册见 [docs/LOCAL_DEPLOYMENT.md](docs/LOCAL_DEPLOYMENT.md)。
