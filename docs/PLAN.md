# Interactive Codebase Model — MVP with 3D Explorer

## Context

The user shared a product spec (`interactive_codebase_model.md`) for a platform that turns an uploaded codebase into a multi-level, explorable system model (product → architecture → domain → component → function → source), combining deterministic static analysis with AI explanation and both 2D and 3D visualization.

The full spec is a multi-month platform (many languages, graph DB, incremental sync, impact analysis, etc.). The user confirmed they want an **MVP that includes 3D visualization from the start**, parsing **TypeScript/JavaScript, Python, and C#**, using **ChatGPT (OpenAI)** for the AI layer. This is greenfield — no existing repo to build on (`Personal Projects` contains unrelated projects). Node 20, Python 3.14, and .NET 10 are all available locally, but the build itself will be a single Node/TypeScript stack for simplicity; multi-language *parsing* is handled via tree-sitter grammars rather than shelling out to each language's own toolchain, which keeps one runtime for the whole app and avoids native build issues on Windows (using `web-tree-sitter` + prebuilt `.wasm` grammars from the `tree-sitter-wasms` package, not native node-gyp bindings).

Goal: a working, narrow vertical slice of the full vision — upload a ZIP → parse it → build the common graph model → explore it in a real 2D list/graph view and a real 3D semantic-zoom scene → drill into source code — with confidence labels on inferred relationships and AI-generated explanations kept evidence-linked, per the doc's own principles (evidence before inference, don't present inference as fact).

## Scope (this pass)

In:
- ZIP upload first; GitHub/GitLab connect is planned through provider OAuth, consent, and repository selection (not pasted personal access tokens)
- Parsers: TypeScript/JavaScript, Python, C# (symbols, imports, best-effort calls)
- Common graph model persisted in SQLite
- Backend API: upload, repo list, graph query, node detail, source fetch, AI explain
- Frontend: upload screen, 2D view (tree + import graph), 3D semantic explorer (React Three Fiber), source viewer (Monaco), search, breadcrumbs
- AI layer: OpenAI-backed "explain this function/class" on demand, evidence-linked (stores which file/lines were sent)
- Baseline security: path-traversal-safe extraction, size limits, ignore binaries/deps/build output, never execute uploaded code, exclude secret-like files (`.env`, `*.pem`, credentials) from AI calls

Out (explicitly deferred, matches the doc's own "Features to Delay"):
- GitHub/GitLab OAuth connection, repository picker, and incremental sync
- Automatic UI mock-up generation
- Full domain/architecture AI reasoning and risk scoring
- Multi-tenant auth, deployment/infra reconstruction

## Architecture

```
interactive-codebase-model/
  backend/                    Node 20 + TypeScript + Express
    src/
      server.ts
      routes/
        upload.ts             POST /api/repos (multipart zip upload)
        repos.ts              GET /api/repos, GET /api/repos/:id
        graph.ts              GET /api/repos/:id/graph, /nodes/:nodeId, /search
        source.ts             GET /api/repos/:id/source?path=
        ai.ts                 POST /api/repos/:id/explain (nodeId) -> OpenAI
      ingestion/
        extractZip.ts         yauzl-based, path-traversal guard, size caps
        ignoreRules.ts         node_modules, .git, dist, build, venv, bin/obj, binaries
        detectLanguage.ts      by extension + package.json/requirements.txt/*.csproj
      parsing/
        treeSitter.ts          loads web-tree-sitter + wasm grammars (ts/tsx/js/python/c_sharp)
        parseFile.ts            per-language symbol/import/call extraction via tree-sitter queries
      graph/
        types.ts               Node/Edge types mirroring the spec's node/edge taxonomy (trimmed)
        buildGraph.ts           turns parsed files into graph nodes/edges, assigns confidence labels
        db.ts                   better-sqlite3 setup + schema (repos, nodes, edges, files)
        queries.ts              graph read/search queries
      ai/
        openai.ts               calls OpenAI API, redacts secrets, records evidence (file:line ranges)
      storage/
        paths.ts                per-repo storage dir under a local data/ folder
    package.json, tsconfig.json

  frontend/                   Vite + React + TypeScript
    src/
      App.tsx                  routing between Upload and Explorer
      api/client.ts
      state/store.ts           zustand: current repo, selected node, breadcrumb path, view mode
      views/
        UploadView.tsx
        ExplorerView.tsx        holds Breadcrumbs + SearchBar + view switcher (2D/3D/Source)
      components/
        Graph2D.tsx             d3-force based container/import graph (canvas)
        Graph3DScene.tsx        React Three Fiber scene: hierarchical regions, click-to-zoom,
                                 OrbitControls, scroll-to-enter/exit semantics, minimap
        SourceViewer.tsx        @monaco-editor/react, highlights selected symbol's lines
        NodeDetailPanel.tsx     shows purpose/callers/callees/AI explanation + evidence links
        Breadcrumbs.tsx
        SearchBar.tsx
      package.json, vite.config.ts, tsconfig.json

  README.md                   dev setup: npm install, npm run dev (both), env vars (OPENAI_API_KEY)
  .gitignore                  data/, node_modules, .env
```

## Data model (SQLite)

Tables: `repos`, `files`, `nodes` (id, repo_id, type, name, file_id, start_line, end_line, metadata JSON), `edges` (id, repo_id, from_node_id, to_node_id, type, confidence, evidence JSON).

Node types (trimmed from spec): Repository, Folder, File, Class, Interface, Function, ImportedModule.
Edge types: Contains, Imports, Calls.
Confidence values: `statically-confirmed` (same-file resolved calls, all imports/containment), `framework-derived` (cross-file name-matched calls resolved via import), unlabeled/omitted edges are simply not created rather than guessed.

## Key implementation notes

- **Zip safety**: reject entries whose resolved path escapes the extraction root; enforce a max total uncompressed size and max file count before writing anything to disk.
- **Tree-sitter**: one loader (`treeSitter.ts`) initializes `web-tree-sitter` once and loads the four grammars from `tree-sitter-wasms`; `parseFile.ts` dispatches by detected language and runs small tree-sitter queries per language to pull declarations/imports/calls — this is the deterministic layer the spec insists must come before any AI step.
- **3D explorer**: nodes for the current level are laid out in a simple radial/grid arrangement inside R3F; clicking a node camera-tweens into it and reveals its children (folders/files/classes/functions), scrolling out (or breadcrumb click) reverses it. This is a real but simplified version of the spec's "semantic zoom" — not full LOD/clustering, which is future work once repos are large.
- **AI explain**: only called on demand per node (not bulk), sends the node's source snippet plus immediate imports, strips files matching secret patterns before ever reaching this path, and returns `{ explanation, evidence: [{file, startLine, endLine}] }` which the UI renders next to the source, honoring "every explanation must be traceable."
- **Env**: `OPENAI_API_KEY` read from `.env` (gitignored); AI explain endpoint returns a clear error if unset rather than failing silently.

## Verification

1. `npm install` in both `backend/` and `frontend/`.
2. Start backend (`npm run dev`) and frontend (`npm run dev`), confirm both boot without errors.
3. Create a tiny sample multi-language repo in the scratchpad (a few TS files with imports/calls, a Python file, a C# file), zip it, upload through the UI.
4. Confirm: graph builds, 2D view shows containment/import structure, 3D view renders nodes and supports click-to-zoom + breadcrumb-back, source viewer opens a file with the right lines highlighted, search finds a symbol by name.
5. Set `OPENAI_API_KEY` and confirm the "Explain" panel returns text with evidence file/line references; unset it and confirm a clear error instead of a crash.
6. Use the Browser tool to actually click through the app (upload → explore 2D → explore 3D → open source → run AI explain) before calling this done, per the project's own rule that UI work must be verified in a real browser, not just by starting the server.

## Status

Implemented and verified end-to-end in the browser (upload → 2D → 3D drill-down → source view with line highlighting → search → AI explain error path without a key). Deterministic reverse-dependency impact analysis is now implemented as the first post-MVP phase. Remaining phases are GitHub/GitLab OAuth repository selection and incremental sync, evidence-backed domain and architecture reasoning, diagram generation, UI mock-up generation, and risk scoring. Authentication for ICM itself and multi-tenant deployment remain intentionally out of scope.
