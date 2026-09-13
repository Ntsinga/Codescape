# Codescape

Codescape maps any codebase into a 3D interactive set of layers, explaining it from a system and conceptual level all the way down to the file and code level. The intention is to be able to know and understand a system/repo at a few glances — instantly seeing where everything is, its purpose in the overall system, and how it connects.

**An explorable atlas of any codebase.** Upload a repo and Codescape builds a navigable system model — zoom from high-level capabilities down through files and functions to the source itself, like an atlas that goes from continents to streets.

Supports TypeScript/JavaScript, Python, and C#. Explore the model as a conceptual **Map** or the raw **Files** structure, in 3D or 2D, with a source-linked code viewer. AI naming/explanations (via OpenAI or Google Gemini, with automatic fallback) are optional and always tied to the exact source lines used.

This is a narrow MVP slice of the full product vision described in [docs/product-vision.md](docs/product-vision.md) (the original spec) — see [docs/PLAN.md](docs/PLAN.md) for what was actually built and why. Deterministic parsing comes first (tree-sitter), then a common graph model, then optional AI explanation on top — not the other way around.

## Setup

```bash
cd backend && npm install
cd ../frontend && npm install
```

Copy `backend/.env.example` to `backend/.env`. `DATABASE_URL` (a Postgres connection string — [Neon](https://neon.tech) has a free tier) is required; everything durable (repos, graph, semantic tree, source file contents) lives there, not on local disk. Set `OPENAI_API_KEY`, `GEMINI_API_KEY`, and/or `DEEPSEEK_API_KEY` for AI naming/explanations (everything else works without a key). The `*_MODEL` vars pick a model, and `AI_PROVIDER` forces one; otherwise whichever key is present is used, with automatic fallback across the others.

## Run

```bash
# terminal 1
cd backend && npm run dev

# terminal 2
cd frontend && npm run dev
```

Open http://localhost:5173. The frontend proxies `/api` to the backend on port 4000.

## Deployment

Deployed as two [Render](https://render.com) free-tier services backed by [Neon](https://neon.tech) Postgres:

- **Backend** — a Render Web Service (Node). Free web services spin down after 15 minutes idle, so the first request after a quiet period takes ~30-60s to wake up.
- **Frontend** — a Render Static Site (always warm, served over Render's CDN), built with `VITE_API_BASE` pointing at the backend's URL.

Set `DATABASE_URL` and any AI/GitHub keys as environment variables on the backend service (never commit them). Since the backend's disk is not persistent, ZIP extraction is scratch space only — everything durable is written to Postgres and the local copy is deleted once processing finishes.

## What's implemented

- Secure ZIP upload: path-traversal-safe extraction, per-file and total size limits, `node_modules`/`.git`/`dist`/`venv`/`bin`/`obj`/etc. ignored automatically.
- Deterministic parsing via tree-sitter (`web-tree-sitter` + WASM grammars) for TypeScript, JavaScript, Python, and C#: classes, interfaces, functions/methods, imports, and calls.
- A common graph model (Repository → Folder → File → Class/Interface/Function, plus Imports/Calls edges) persisted in Postgres, with every relationship labeled `statically-confirmed` or `framework-derived` — unresolved calls are omitted rather than guessed.
- 2D architecture view (canvas + force layout), 3D semantic-zoom explorer (React Three Fiber — double-click to drill in, scroll out or use breadcrumbs to go back), and a Monaco-based source viewer that jumps to and highlights the selected symbol.
- On-demand AI explanation per node (OpenAI), scoped to that node's own source plus its direct imports, with the explanation always shown next to the exact file/line evidence used to generate it. Files matching secret-like patterns (`.env`, `*.pem`, credentials, etc.) are excluded from both the source viewer and the AI path.
- Deterministic impact analysis for a selected node, following reverse `Calls` and `Imports` relationships and showing dependency depth.

## What's deliberately out of scope for this pass

Incremental sync of live repositories, automatic UI mock-up generation, and full domain/architecture AI reasoning. Repository access uses GitHub OAuth with a consent screen and repository picker; users never paste personal access tokens. Authentication for Codescape itself and multi-tenant deployment are intentionally not planned for the current product phase.
