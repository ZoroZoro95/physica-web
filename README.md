# Physica Frontend

Next.js frontend for the projectile-motion solver, visual explainer, auth entry point, and failed-question status page.

## Local Run

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

## Required Environment

```bash
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
NEXT_PUBLIC_GOOGLE_CLIENT_ID=
```

## Beta Checks

```bash
npm run build
```

Also run the monorepo deployment gate before releasing:

```bash
python3 ../scripts/deployment_gate.py
```

## Pages

- `/`: solver, extraction review, solution, visual explainer, sign-in panel.
- `/failed-questions`: signed-in user view for failed questions that are open or fixed.
- `/audit/walkthrough-sync`: internal walkthrough/animation sync audit.
- `/v2-player`: experimental v2 projectile player.

## Deployment

Deploy this directory to Vercel. Set `NEXT_PUBLIC_API_URL` to the Railway backend URL and `NEXT_PUBLIC_GOOGLE_CLIENT_ID` to the same Google OAuth client audience used by the backend.
