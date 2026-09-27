import "dotenv/config";
import express from "express";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";
import swaggerUi from "swagger-ui-express";
import { requireUser } from "./auth.js";
import { openApiSpec } from "./openapi.js";
import { ensureDataDirs } from "./storage/paths.js";
import { ensureMigrated } from "./graph/db.js";
import { failStaleProcessing } from "./graph/queries.js";
import { uploadRouter } from "./routes/upload.js";
import { reposRouter } from "./routes/repos.js";
import { graphRouter } from "./routes/graph.js";
import { sourceRouter } from "./routes/source.js";
import { aiRouter } from "./routes/ai.js";
import { githubRouter } from "./routes/github.js";
import { semanticRouter } from "./routes/semantic.js";

async function main() {
  ensureDataDirs();
  await ensureMigrated(); // run Postgres migrations before accepting traffic
  const recovered = await failStaleProcessing().catch(() => 0);
  if (recovered) console.log(`Recovered ${recovered} repo(s) stuck in "processing" from a prior restart.`);

  const app = express();
  app.use(cors());
  app.use(express.json());
  // Populates req.auth from either a session cookie or an Authorization: Bearer
  // <token> header. Does NOT block unauthenticated requests by itself — routes
  // that need a signed-in user are individually gated with requireUser below.
  app.use(clerkMiddleware());

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  // Interactive API docs (Swagger UI) + raw spec.
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openApiSpec, { customSiteTitle: "Codescape API" }));
  app.get("/api/openapi.json", (_req, res) => res.json(openApiSpec));

  // Friendly root so hitting the backend URL directly isn't a bare "Cannot GET /".
  const apiIndex = {
    service: "codescape-backend",
    status: "ok",
    docs: "/api/docs",
    openapi: "/api/openapi.json",
    endpoints: [
      "GET  /api/health",
      "GET  /api/repos",
      "POST /api/repos            (multipart zip upload)",
      "GET  /api/repos/:id/graph",
      "GET  /api/repos/:id/semantic",
      "POST /api/repos/:id/decompose",
      "GET  /api/repos/:id/source?path=",
      "GET  /api/repos/:id/stack",
      "POST /api/repos/:id/nodes/:nodeId/explain",
      "GET  /api/ai/models",
      "POST /api/github/connect-url",
      "GET  /api/docs            (Swagger UI)",
    ],
    repo: "https://github.com/Ntsinga/Codescape",
  };
  app.get("/", (_req, res) => res.json(apiIndex));
  app.get("/api", (_req, res) => res.json(apiIndex));

  // Each router below serves per-user data (repos, graph, source, AI actions), so
  // every route in them requires a signed-in Clerk user. githubRouter is the one
  // exception: it gates each of its routes individually, because /github/callback
  // is a plain browser navigation from GitHub (no Authorization header to check)
  // rather than one of the frontend's authenticated fetch calls.
  app.use("/api", requireUser, uploadRouter);
  app.use("/api", requireUser, reposRouter);
  app.use("/api", requireUser, graphRouter);
  app.use("/api", requireUser, sourceRouter);
  app.use("/api", requireUser, aiRouter);
  app.use("/api", githubRouter);
  app.use("/api", requireUser, semanticRouter);

  const port = Number(process.env.PORT) || 4000;
  app.listen(port, () => {
    console.log(`codescape-backend listening on http://localhost:${port}`);
    // TEMPORARY: baseline memory right after boot, to compare against the
    // per-stage [mem] logs an import prints (see ingestion/processRepo.ts).
    const m = process.memoryUsage();
    console.log(`[mem] server ready: rss=${(m.rss / 1024 / 1024).toFixed(1)}MB heapUsed=${(m.heapUsed / 1024 / 1024).toFixed(1)}MB`);
  });
}

// Keep the process alive on stray async errors (a single bad request shouldn't
// take the whole server down). Genuine OOM kills are not catchable here.
process.on("unhandledRejection", (reason) => console.error("[unhandledRejection]", reason));
process.on("uncaughtException", (err) => console.error("[uncaughtException]", err));

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
