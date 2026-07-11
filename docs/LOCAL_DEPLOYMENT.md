# CD-BOX 本机部署与运维

CD-BOX 的个人使用版本完全运行在本机，不依赖 Vercel、其他云托管、付费搜索 API、云数据库或外部登录。应用只监听 `127.0.0.1`，不会向局域网或互联网开放。

## 运行结构

- Next.js 生产服务器：`http://127.0.0.1:3000`
- PostgreSQL：本机 PostgreSQL 16
- AI：通过 `.env.local` 中配置的 OpenAI-compatible 中转站
- 联网发行证据：MusicBrainz、NDL Search、Discogs 与 Cover Art Archive 公共接口；无需新增付费订阅
- 数据备份：`var/backups/postgres/`

真实密钥和数据库密码只能保存在 Git 忽略的 `.env.local` 中。仓库里的 `.env.example` 只包含占位符。

Bootstrap 使用中转站 `/models` 已确认的 `gpt-5.6-terra`。真实探针确认 Chat Completions 和 JSON 可用，而 Responses 会完成但不返回正文、原生 `web_search` 不可用，因此本机实际配置固定为 `AI_TEXT_PROTOCOL=chat-completions`，并写入 `AI_RESPONSES_SUPPORTED=false`、`AI_CHAT_COMPLETIONS_SUPPORTED=true`、`AI_WEB_SEARCH_SUPPORTED=false`，避免每次先产生一次无效且可能计费的 Responses 请求。联网发行流程不依赖原生搜索：MusicBrainz 分页归并后必须通过 NDL 国家书目硬核验和 Discogs 辅助印证，GPT-5.6 只比较所给证据并可拒绝，不能创造事实或绕过确定性门禁。默认不启用额外推理强度（`AI_REASONING_EFFORT=none`），单次请求超时为 300 秒；能力未经探针验证前不能自行声明为可用。

## 联网资料服务规则

- MusicBrainz：使用明确 User-Agent，串行请求并遵守至少约 1 请求/秒的公共限速；分页结果按 release group 归并，源端不完整时不得假装完整。
- NDL Search：国家书目是日本实体 CD 的权威硬核验源。应用显示 “This application uses the NDL Search API.”，书目元数据按 CC BY 4.0 署名；请求默认串行、至少间隔 1 秒、有限重试并缓存 24 小时。
- Discogs：只作为辅助印证。应用显示 “Data provided by Discogs.” 及非隶属声明；匿名请求默认串行、至少间隔 2.5 秒，并遵守响应中的限速与 `Retry-After`。分页不完整时不返回已核验候选。
- Cover Art Archive / Discogs：只接受精确实体 release 的 CAA front 或 Discogs `primary`。每张封面必须通过 HTTPS 主机白名单、受控重定向、真实文件签名、MIME、尺寸与响应体上限检查。
- 未核验、证据冲突、歧义或无有效封面的条目不会出现在正常艺人库或最终搜索结果中，也不能导入。

NDL 与 Discogs 的署名在应用全局页脚和联网研究结果区持续可见。不要删除、隐藏或改写这些声明。

## 首次全自动初始化

将中转站密钥单独放入 Windows 剪贴板，然后在管理员权限的终端执行：

```powershell
npm run local:bootstrap
```

该命令不会读取或输出已有 `.env.local`。默认发现已有文件时立即停止；只有显式传入 `-ReplaceExistingEnvFile` 才会原子替换。正常首次初始化会：

1. 验证管理员权限、PostgreSQL 16 服务、数据目录、实际端口和 `pg_hba.conf` 路径。
2. 验证剪贴板只包含一个非空的 `sk-` 样式密钥，但绝不打印它。
3. 生成强随机数据库密码和 `AUTH_SECRET`。
4. 原子备份 `pg_hba.conf`，只在最前面短暂加入 `hostnossl postgres postgres 127.0.0.1/32 trust`。
5. reload 后创建无超级用户权限的 `cd_box_app` 角色和全新的 `cd_box` 数据库；如果任一对象已经存在则拒绝修改。
6. 在 `finally` 中恢复字节级一致的原文件、再次 reload，并进行 SHA-256 校验。
7. 以仅当前用户、SYSTEM 和 Administrators 可读的 ACL 原子写入 `.env.local`。
8. 自动运行数据库 migration 和 Next.js 生产构建。

脚本不创建临时 SQL 文件；包含数据库密码的 SQL 只通过标准输入发送给本机 `psql`。如果数据库创建已经开始后发生异常，脚本不会删除角色或数据库，并会保留一个受保护且被 Git 忽略的 recovery 环境文件。正常成功或创建前失败时会清理全部临时文件。

## 首次初始化或代码更新后

```powershell
npm run local:setup
```

已有旧版本正在运行时，先确认没有进行中的搜索或导入，再按以下顺序更新：

```powershell
npm run local:stop
npm run local:setup
npm run local:start
```

该命令会以非交互方式完成以下工作：

1. 在缺少 `node_modules` 时执行锁定版本安装。
2. 确认目标 PostgreSQL 数据库存在。
3. 生成 Prisma Client 并应用仓库内已提交的 migration。
4. 生成 Next.js 生产构建。

脚本从进程环境读取 `DATABASE_URL`。npm 命令会通过 Node.js 的 `--env-file-if-exists=.env.local` 安全载入本机配置；脚本不会输出连接串或密码。

## 启动与安全停止

```powershell
npm run local:start
```

启动脚本实际执行 `next start -H 127.0.0.1 -p 3000`，并强制启用本机 owner 模式和回环地址。需要更换端口时可执行：

```powershell
npm run local:start -- -Port 3100
```

前台运行时，优先在运行窗口按一次 `Ctrl+C`，然后等待进程退出，最多预留 30 秒。后台运行且确认没有进行中的搜索或导入时，可执行 `npm run local:stop`；该命令只会停止当前项目在回环地址上的 Next.js 进程，端口属于其他程序时会拒绝操作。不要在 AI 任务运行时直接关闭终端、使用任务管理器结束进程或强制关机。

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

如果应用使用的不是默认 3000 端口，请同时传入 `-AppPort`。

恢复脚本会校验归档及 SHA-256（存在校验文件时），确认端口 3000 未被监听，并在覆盖数据前自动再做一份安全备份。恢复使用单事务；出现错误时 PostgreSQL 会回滚本次恢复。

## 日常维护

- 每次重要导入或大批量编辑前执行一次备份。
- 至少将一份备份复制到本机之外的存储设备。
- 代码更新后按 `local:stop` → `local:setup` → `local:start` 执行；`local:setup` 每次都会按 lockfile 重装依赖。不要使用 `prisma db push` 替代 migration。
- schema 或核验规则更新后，先运行 `npm run library:verify` 查看历史库回填预览；确认并备份后才运行 `npm run library:verify:apply`。预览命令不写库，应用命令也不会提升无封面或未通过证据链的记录。
- 本机启动无需反向代理；只有将来决定向其他设备开放时，才需要重新设计认证、TLS 和网络边界。
