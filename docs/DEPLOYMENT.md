# CD-BOX Production Deployment

> 状态（2026-07-11）：Vercel、Neon migration、GitHub OAuth 生产回调、owner 登录、Responses API 与真实 `web_search` 已完成。最终验收仍需通过完整收藏工作流。

CD-BOX 的生产基线采用以下组合：

- Vercel：托管 Next.js App Router 应用与 GitHub 持续部署。
- Vercel Marketplace 的 Neon PostgreSQL：保存单一 owner 身份、共享发行目录与 owner 收藏状态。
- GitHub OAuth：唯一登录方式；`AUTH_GITHUB_ALLOWED_ID=26319181` 以稳定 numeric ID 限制为仓库所有者账号。
- Vercel AI Gateway：通过部署自动注入的 OIDC token 调用中等推理强度的流式 Responses API、当前默认的 `openai/gpt-5.6-sol` 和强制 `web_search`。

## 1. GitHub OAuth

在 GitHub 创建 OAuth App，并为实际域名配置：

- Homepage URL：`https://<production-domain>`
- Authorization callback URL：`https://<production-domain>/api/auth/callback/github`

本地开发 OAuth App 可使用：

- Homepage URL：`http://localhost:3000`
- Authorization callback URL：`http://localhost:3000/api/auth/callback/github`

CD-BOX 不提供注册、邀请、角色或用户管理。生产环境将 `AUTH_GITHUB_ALLOWED_ID` 固定为 `26319181`；只有该稳定 GitHub numeric ID 可以创建有效会话。`AUTH_GITHUB_ALLOWED_LOGIN=KAtOReNA7` 只用于显示回退，不参与授权。

## 2. Vercel 与 PostgreSQL

1. 将 GitHub 仓库导入 Vercel。
2. 在项目的 Marketplace 中连接 Neon PostgreSQL。
3. 确认集成为项目写入 `DATABASE_URL`。
4. 在首次发布前运行：

```bash
npm run db:generate
npm run db:migrate:deploy
```

不要在生产环境使用 `prisma db push` 代替已提交的 migration。

## 3. Required Environment Variables

在 Vercel 的 Development、Preview 与 Production 环境中配置：

```bash
DATABASE_URL=
AUTH_SECRET=
NEXTAUTH_URL=https://<production-domain>
AUTH_GITHUB_ID=
AUTH_GITHUB_SECRET=
AUTH_GITHUB_ALLOWED_ID=26319181
AUTH_GITHUB_ALLOWED_LOGIN=KAtOReNA7
OPENAI_API_KEY=
AI_GATEWAY_API_KEY=
OPENAI_BASE_URL=https://ai-gateway.vercel.sh/v1
OPENAI_TEXT_MODEL=openai/gpt-5.6-sol
OPENAI_IMAGE_MODEL=openai/gpt-image-2
AI_PROVIDER_MODE=vercel-ai-gateway
AI_ENABLE_WEB_SEARCH=true
AI_ENABLE_IMAGE_GENERATION=false
```

`AUTH_SECRET` 应使用高熵随机值。Vercel 生产部署使用自动注入的 `VERCEL_OIDC_TOKEN`，无需保存 Gateway 密钥；本地调用可使用 `AI_GATEWAY_API_KEY`。任何真实密钥都只能存放在本地忽略的 `.env.local` 或 Vercel 加密环境变量中，不得提交到 Git。

## 4. AI Release Gate

正式发布前必须运行：

```bash
npm run probe:ai
```

探测结果必须同时满足：

- `responsesSupported=true`
- `webSearchSupported=true`
- `textModel="openai/gpt-5.6-sol"`

如果中转站不能完成 GPT-5.6 Sol 的 Responses API 或强制 `web_search` 探测，将 `OPENAI_TEXT_MODEL` 显式改为 `openai/gpt-5.5` 并重新部署、重新执行全部探测。应用不在单次请求内自动切换模型；若 GPT-5.5 也失败，则回滚到最近一次已经通过生产探测的模型配置。

每次修改模型变量并重新部署后，都必须重新执行 `models`、`responses` 与 `web-search` 三项生产诊断。2026-07-11 记录的 `status=200` 仅是变更前配置的历史结果，不能替代 GPT-5.6 Sol 的本次验收。

如果 `webSearchSupported=false`，联网发行研究保持关闭；应用不得回退到普通聊天补全并声称已经搜索互联网。

## 5. Release Verification

```bash
npm ci
npm run audit:prod
npm run db:generate
npm run typecheck
npm test
npm run lint
npm run build
```

上线后依次验收：GitHub owner numeric ID 登录、非 allowlist ID 账号拒绝、创建艺人、Excel 预览与确认导入、真实 `web_search` 联网发行研究、候选编辑与导入、收藏状态更新、Excel 导出、退出登录。全部通过前不得把生产 MVP 标记为已发布。
