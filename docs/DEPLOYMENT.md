# CD-BOX 本机发布基线

> 状态（2026-07-11）：项目的最终运行目标是 Windows 本机单用户版本。发布是指本机生产构建与完整验收，不包含云端部署。

## 1. 最终架构

| 模块 | 最终方案 |
| --- | --- |
| Web 应用 | 单个 Next.js 生产进程，只监听 `127.0.0.1:3000` |
| 身份边界 | `LOCAL_OWNER_MODE=true`，仅允许数值回环地址请求 |
| 数据库 | 本机 PostgreSQL 16，独立的低权限 `cd_box_app` 角色与 `cd_box` 数据库 |
| AI | 现有 OpenAI-compatible 中转站，`gpt-5.6-terra`，Chat Completions |
| 联网证据 | MusicBrainz 与 Cover Art Archive；Apple Music 仅作严格匹配后的名称与封面补全 |
| 备份 | 本机 `pg_dump` custom archive、SHA-256 校验与轮换保留 |

该架构没有云托管、云数据库、外部 OAuth、付费搜索 API 或 AI 路由网关依赖。公共资料服务不收取 API 订阅费，但必须遵守其使用条款、User-Agent 要求和速率限制。中转站只使用用户已有额度，不引入新的付费服务。

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
- 发行研究直接查询 MusicBrainz 与 Cover Art Archive，并按来源确定性整理；默认不调用 GPT，避免额外费用和长时间等待。
- 模型输出不得新增日期、品番、厂牌、格式、封面、来源、再版或重制结论。违反约束时使用确定性证据映射。
- 模型鉴权、额度或模型错误不会被伪装为搜索成功；仅当公共源已经产生确定性候选时，系统才带明确警告返回这些候选。
- Apple Music 补全必须满足唯一艺人、精确标题和年份匹配，不能提升发行证据置信度。

重新更换中转站或模型后运行：

```powershell
npm run probe:ai
```

探针不得执行图片生成，也不得输出密钥。能力声明只能按真实探针结果修改。

## 5. 更新、备份与恢复

代码更新后执行：

```powershell
npm run local:setup
```

重要导入前后执行：

```powershell
npm run local:db:backup
```

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
4. 公共资料联网研究返回带来源的候选；进度、警告、封面和原文艺人名正确。
5. 候选编辑、全选、导入、收藏状态和来源管理正常。
6. 备份、只读校验和一次测试恢复正常。
7. `Ctrl+C` 能优雅停止正在运行的本机进程。

全部通过后才将本机构建标记为可日常使用版本。
