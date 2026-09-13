import { Router } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { getRepo } from "../graph/queries.js";
import { repoSourceDir } from "../storage/paths.js";
import { isSecretLike } from "../ingestion/ignoreRules.js";

export const sourceRouter = Router();

sourceRouter.get("/repos/:id/source", async (req, res) => {
  const repo = getRepo(req.params.id);
  if (!repo) {
    res.status(404).json({ error: "Repository not found" });
    return;
  }

  const relPath = req.query.path as string | undefined;
  if (!relPath) {
    res.status(400).json({ error: "Missing 'path' query parameter" });
    return;
  }
  if (isSecretLike(relPath)) {
    res.status(403).json({ error: "This file is excluded as potentially sensitive" });
    return;
  }

  const root = repoSourceDir(repo.id);
  const resolved = path.resolve(root, relPath);
  const relativeCheck = path.relative(root, resolved);
  if (relativeCheck.startsWith("..") || path.isAbsolute(relativeCheck)) {
    res.status(400).json({ error: "Invalid path" });
    return;
  }

  try {
    const content = await fs.readFile(resolved, "utf-8");
    res.json({ path: relPath, content });
  } catch {
    res.status(404).json({ error: "File not found" });
  }
});
