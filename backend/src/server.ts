import "dotenv/config";
import express from "express";
import cors from "cors";
import { ensureDataDirs } from "./storage/paths.js";
import { getDb } from "./graph/db.js";
import { uploadRouter } from "./routes/upload.js";
import { reposRouter } from "./routes/repos.js";
import { graphRouter } from "./routes/graph.js";
import { sourceRouter } from "./routes/source.js";
import { aiRouter } from "./routes/ai.js";
import { githubRouter } from "./routes/github.js";
import { semanticRouter } from "./routes/semantic.js";

ensureDataDirs();
getDb(); // run migrations eagerly so the first request isn't slow

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api", uploadRouter);
app.use("/api", reposRouter);
app.use("/api", graphRouter);
app.use("/api", sourceRouter);
app.use("/api", aiRouter);
app.use("/api", githubRouter);
app.use("/api", semanticRouter);

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
  console.log(`codescape-backend listening on http://localhost:${port}`);
});
