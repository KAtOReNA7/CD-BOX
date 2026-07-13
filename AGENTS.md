# CD-BOX 仓库协作规则

## 发布目标

- CD-BOX 是 Windows 本机、单 owner、仅回环地址可访问的个人工具。不要引入 Vercel、云数据库、外部登录或新的付费服务。
- 当前发布分支是 `codex/production-mvp`。远端默认分支 `main` 未同步前，给新电脑的克隆命令必须显式指定 `--branch codex/production-mvp --single-branch`。
- 所有安装、启动、更新、备份和恢复命令以 `README.md` 与 `docs/LOCAL_DEPLOYMENT.md` 为准。修改运维脚本时必须同步这两份文档。

## 冻结的产品范围与数据粒度

- 规范目标是收录艺人的**全部官方发行**，不得把 `ORIGINAL_CD`、单曲或原创专辑误写成产品总范围。类别包括但不限于：单曲、EP／迷你专辑、原创专辑、精选、Live、Remix、Soundtrack、Tribute、普通合集、Box Set、官方影像和其他官方发行。
- 介质范围包括全部官方音频和视频介质。官方 promo、非卖品、自费发行、会场限定和歌迷会发行属于目标范围；非官方发行、盗版和卖家自行拼装的套装不收录。
- 顶层实体按**作品**归并，地区版、介质版、初回版、再版、重制版、豪华版和其他商品版本作为该作品下的嵌套版本保存。不得把同一作品的版本重复统计成多个顶层作品，也不得仅因日期相同就合并名称不同的作品。Box Set 作为官方作品保存时，另行表达其与所含作品的关系，不能用碟数冒充作品数。
- 作品身份、作品首次正式发行日期与具体版本的地区、介质、品番、版本日期必须分开保存。标题原文、不同文字别名和艺人 credit 必须可追溯到各自来源。
- 运行时代码必须采用通用的类别、介质、作品／版本和证据规则。艺人 fixture 可以保存版本化事实，但禁止把某位艺人的标题、候选 ID、固定来源数组或临时恢复逻辑硬编码成产品规则。

## 规范目标与当前门禁

- 上述冻结范围是产品规范。仓库当前只覆盖 `ORIGINAL_CD`、部分类别或四位艺人的 fixture、脚本和测试，只能称为**当前回归门禁**，不能称为完整产品验收，也不能反过来缩小产品规范。
- 过渡期必须分别报告“当前门禁是否通过”和“距离冻结规范还缺哪些能力／数据”。不得为了让旧门禁变绿而放弃 EP、影像、Box Set、promo 等已确认范围；应通过迁移、通用模型和版本化 fixture 逐步更新门禁。
- 旧数据格式兼容、公共来源健康、目录守恒、可发布资料质量和产品功能验收是不同问题。维护工具应先只读聚合报告全部不兼容，再执行版本化迁移；禁止在真实联网验收中逐个发现旧格式并不断增加艺人特例。

## 证据、AI 与封面边界

- `VERIFIED` 表示发行身份和官方属性已由资料证据、确定性规则及必要的 AI 语义复核通过。确定性的艺人、标题、版本、介质、地区、品番和日期匹配由程序完成；AI 只裁决已提供证据中的跨文字等值或实质冲突，不能浏览、凭记忆补事实、创造来源、修改确定性字段或绕过证据门禁。
- 不要求每条记录同时命中所有来源，但市场列表、封面图片或模型判断不能单独证明发行是官方的。正规零售和二手市场仅可在发行身份已独立成立后用于补图或补充版本线索。
- 封面与 `VERIFIED` 独立，状态至少区分 `EDITION`、`WORK`、`MISSING`。优先保存与具体版本绑定的正确封面，其次可保存明确标注为作品级的正确封面；缺少封面不得阻塞 `VERIFIED`、展示、选择或导入，也不得用错误图片、生成图或无来源图片填空。
- 封面候选先满足适用性、身份正确和安全校验，再按近期速度、成功率和熔断状态动态排序；不得把固定提供商顺序写成产品语义。可使用官方来源、Cover Art Archive／Discogs、正规零售和二手市场补图，但后两类不能单独提升官方性或证据等级。
- 只访问无需额外付费且允许公开访问的页面或 API；不得绕过登录、验证码、付费墙、反自动化保护或服务条款。来源不可用时保留资料和 `MISSING`／待补状态，不能删除正确发行或无限同步等待。

## 任务预算、检查点与停止规则

- 一次完整搜索的正常目标是 3–8 分钟，单艺人硬上限是 15 分钟。到达硬上限必须保存已有资料和明确的未完成原因，安全结束本轮并进入可恢复状态；禁止继续静默运行。
- AI 每批约 20 个需要语义裁决的候选，并根据提示体积向下调整。单次 AI 请求硬超时 75 秒；一次批次在首次失败后最多允许 2 次有界修复请求，禁止递归二分形成请求树。连续 2 次 AI 失败立即熔断；单艺人的全部 AI 阶段硬上限是 10 分钟。
- 前台封面补全阶段硬上限是 3 分钟。到限立即返回已有发行资料和独立封面状态，后续只能从检查点后台或人工重试，不能阻塞 `VERIFIED` 或导入。
- 每完成一个来源页、一个 AI 批次或一个封面批次，都必须立即原子持久化 Git 忽略的检查点；检查点绑定输入、策略／fixture 哈希和版本。恢复时只继续缺失部分，不重新请求或重新裁决已经通过且输入未变的部分。
- 所有长任务必须显示当前阶段、已完成／总数、已用时间、剩余硬预算和最近检查点。调用方必须声明有界心跳；连续缺少预期进度或心跳时应优雅停止并诊断，不能因为进程尚未退出就继续等待数小时。
- 任何阶段到达其硬上限都视为需要诊断的终止条件，不得扩大超时、追加无界重试或从头重跑来掩盖问题。同一提交禁止重复运行完整真实 AI 套件；失败后只能修复离线问题并从未完成检查点恢复。
- 若一次开发执行在约定检查点内没有产生可审计产出（代码差异、聚合诊断、通过的有界测试或持久检查点），立即停止该执行，保留现场并报告最后成功阶段、当前阻塞、已耗预算和下一种更小的诊断方法。禁止以“仍在运行”为由继续无产出工作。

## 完整验收艺人

- 完整产品验收必须覆盖：中山美穂、松田聖子、中森明菜、山口百恵、坂本龍一、邓丽君、王菲、The Beatles。它们共同覆盖大型日本旧目录、多类别／多介质、影像与 soundtrack、跨文字与跨市场目录以及西方艺人目录。
- 八位艺人都必须按冻结的全部官方发行范围验证作品守恒、版本嵌套、证据边界、独立封面状态、检查点恢复和硬时限。当前只有其中部分艺人的 fixture 时，应明确标记验收不完整，不得用四艺人 `ORIGINAL_CD` 结果代替完整验收。
- 验收数据可以包含艺人专属的版本化期望和权威来源，但实现必须保持通用；新增艺人不应要求修改核心筛选、证据或封面算法中的姓名特例。
- 冻结 gold reference 中的官方作品和已知版本必须 100% 被发现并正确归并；错误或非官方 `VERIFIED` 必须为 0；所有候选必须有明确去向；展示封面错误数必须为 0，自动封面命中率目标不低于 80%。只比较总数不能代替逐标题、逐版本核对。

## 新电脑安装边界

协助用户在新 Windows 电脑安装时，必须清楚区分人工步骤和脚本能力：

1. 用户必须人工安装 Git for Windows、Node.js `24.16.0`（npm `11.x`，项目锁定 `11.13.0`）和 PostgreSQL Windows x64 `16`。
2. PostgreSQL 推荐服务名 `postgresql-x64-16`、端口 `55432`，且服务必须处于 `Running`。不要声称 bootstrap 会安装或重新配置 PostgreSQL 安装包。
3. 下载命令使用：

   ```powershell
   git clone --branch codex/production-mvp --single-branch https://github.com/KAtOReNA7/CD-BOX.git
   Set-Location .\CD-BOX
   ```

4. 用户只需将中转站 `sk-...` 密钥单独复制到 Windows 剪贴板，并从管理员 PowerShell 运行 `npm run local:bootstrap`。Bootstrap 写入当前中转站地址、当前密钥实际开放的 `gpt-5.6-terra` 与已验证的 Chat Completions 能力；不得要求用户把真实密钥粘贴进命令、README、Issue、聊天或测试输出。
5. bootstrap 自动创建 `cd_box_app` / `cd_box`、随机数据库密码、`AUTH_SECRET`、受 ACL 保护且被 Git 忽略的 `.env.local`，并运行 `npm ci`、Prisma generate、migration deploy 和 production build。
6. 启动命令是 `npm run local:start`，`npm start` 必须委托给同一入口；开发服务器也必须显式绑定 `127.0.0.1:3000`。本机启动入口不得接受改端口参数，访问地址只能写成 `http://127.0.0.1:3000`。本机 owner 自动建立，无注册、无 GitHub OAuth、无表单登录。
7. GitHub 只包含代码，不包含 PostgreSQL 数据、`.env.local`、API 密钥、`var/`、日志或备份。迁移旧电脑收藏时，用户必须人工复制 `.dump` 与 `.sha256`，再使用 README 中的 `local:db:restore` 流程。

## 密钥和本机安全

- 不读取、不打印、不提交 `.env.local` 或任何真实凭据；不得把密钥作为命令行参数。只允许读取变量是否存在、协议能力或脱敏主机信息。
- 不放宽 `LOCAL_OWNER_MODE`、`LOCAL_OWNER_BIND_HOST=127.0.0.1`、请求 Host/Origin 校验或服务器 `-H 127.0.0.1` 绑定。
- 不为“方便访问”改用 `localhost`、`0.0.0.0`、局域网 IP、反向代理或公网部署。若产品方向需要改变，必须先获得用户明确批准并重新设计认证、TLS 和网络边界。
- 不将数据库备份、真实 Excel、日志、生成构建、`node_modules`、`.next` 或 `var` 加入 Git。
- 搜索、导入、回填、备份或恢复运行中不得强杀进程或关机。优先 `Ctrl+C` 优雅停止；后台服务使用 `npm run local:stop`。

## 数据库和更新

- Prisma 结构变更必须提交 migration，并通过 `prisma migrate deploy` 应用；禁止用 `prisma db push` 代替 migration。
- 更新既有安装时，顺序为：确认无运行任务 → `npm run local:db:backup` → `npm run local:stop` → `git pull --ff-only origin codex/production-mvp` → `npm run local:setup` → `npm run local:start`。
- `local:bootstrap` 只用于全新安装。它发现 `.env.local`、`cd_box_app` 或 `cd_box` 已存在时会安全拒绝；公开入口不得提供替换环境文件或跳过应用安装的参数，也不要通过删除现有数据绕过保护。
- 修改本机脚本后，验证它仍不会输出数据库连接串、密码或中转站密钥，且临时 PostgreSQL trust 规则能在 `finally` 中恢复。
- 已确认中转站存在目标模型时，可用 `npm run local:set-model -- <model-id>` 原位更新受保护的 `.env.local`；命令不得输出环境文件内容，变更后必须重启应用。

## 验证与额度

- 常规提交门禁：`npm run check` 和 `npm run build`。它们不得调用真实 AI。
- `npm run probe:ai` 与 `npm run smoke:verified-discography:ai` 会调用真实中转站并可能消耗额度。只在中转站、模型、协议或证据审计逻辑变化后运行，并提前在进度说明中标记。
- `npm run smoke:verified-discography` 会访问公共元数据服务但不调用 GPT。遵守 MusicBrainz、NDL、Discogs 和 Cover Art Archive 的限速、署名及 fail-closed 规则。
- 大型目录验收先使用 `npm run discography:replay -- <runner 参数>` 回放既有任务。`--replay-tasks` / `--replay-input` 不得调用 AI、公共网络或远程封面；runner 必须跑完全部选定艺人并聚合所有违规，不能首错终止。
- `npm run discography:preflight:offline` 只接受按当前 fixture 哈希保存的已通过检查点，缺失时必须失败且不得回退联网。`npm run discography:preflight` 才允许访问公共资料，并且每位艺人完成后必须原子保存 Git 忽略的 `var/` 检查点。
- `npm run discography:acceptance:ai` 是最终真实 AI 套件。只有离线回放、公共预检、`npm run check`、`npm run build`、migration 和本机运行验收全部通过后才能运行；同一提交最多完整运行一次，失败后使用 `--resume-tasks` 复用已完成艺人，不得从头重复消耗。
- 提交前检查分支、远端祖先关系、未跟踪文件和敏感信息；只暂存本次明确审计过的文件，不使用会把本机文件一并加入的宽泛暂存命令。

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
