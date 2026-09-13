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

Copy `backend/.env.example` to `backend/.env` and set `OPENAI_API_KEY` and/or `GEMINI_API_KEY` for AI naming/explanations (everything else works without a key). `GEMINI_MODEL` / `OPENAI_MODEL` pick the model, and `AI_PROVIDER` forces one; otherwise whichever key is present is used, with automatic fallback to the other.

## Run

```bash
# terminal 1
cd backend && npm run dev

# terminal 2
cd frontend && npm run dev
```

Open http://localhost:5173. The frontend proxies `/api` to the backend on port 4000.

## What's implemented

- Secure ZIP upload: path-traversal-safe extraction, per-file and total size limits, `node_modules`/`.git`/`dist`/`venv`/`bin`/`obj`/etc. ignored automatically.
- Deterministic parsing via tree-sitter (`web-tree-sitter` + WASM grammars) for TypeScript, JavaScript, Python, and C#: classes, interfaces, functions/methods, imports, and calls.
- A common graph model (Repository → Folder → File → Class/Interface/Function, plus Imports/Calls edges) persisted in SQLite, with every relationship labeled `statically-confirmed` or `framework-derived` — unresolved calls are omitted rather than guessed.
- 2D architecture view (canvas + force layout), 3D semantic-zoom explorer (React Three Fiber — double-click to drill in, scroll out or use breadcrumbs to go back), and a Monaco-based source viewer that jumps to and highlights the selected symbol.
- On-demand AI explanation per node (OpenAI), scoped to that node's own source plus its direct imports, with the explanation always shown next to the exact file/line evidence used to generate it. Files matching secret-like patterns (`.env`, `*.pem`, credentials, etc.) are excluded from both the source viewer and the AI path.
- Deterministic impact analysis for a selected node, following reverse `Calls` and `Imports` relationships and showing dependency depth.

## What's deliberately out of scope for this pass

Incremental sync of live repositories, automatic UI mock-up generation, and full domain/architecture AI reasoning. Repository access uses GitHub OAuth with a consent screen and repository picker; users never paste personal access tokens. Authentication for Codescape itself and multi-tenant deployment are intentionally not planned for the current product phase.
