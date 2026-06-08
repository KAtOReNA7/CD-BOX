# CD-BOX

CD-BOX is a Next.js WebUI for physical CD collectors. It manages artist-specific release libraries, source URLs, cover image URLs, and per-user collection status.

## Tech Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- shadcn/ui
- Prisma
- PostgreSQL
- NextAuth
- OpenAI SDK

## Local Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Open http://localhost:3000.

## Environment Variables

```bash
DATABASE_URL=
AUTH_SECRET=
AUTH_GITHUB_ID=
AUTH_GITHUB_SECRET=
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
OPENAI_API_KEY=
OPENAI_BASE_URL=
OPENAI_TEXT_MODEL=gpt-5.5
OPENAI_IMAGE_MODEL=gpt-image-2
```

## Database

Generate the Prisma client:

```bash
npx prisma generate
```

Create and apply a local migration after `DATABASE_URL` points to PostgreSQL:

```bash
npx prisma migrate dev --name init
```

For production deployments:

```bash
npx prisma migrate deploy
```

## Validation

```bash
npm run lint
npm run build
```
