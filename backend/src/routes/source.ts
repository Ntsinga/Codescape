import { Router } from "express";
import { getRepo, getFileContent } from "../graph/queries.js";
import { isSecretLike } from "../ingestion/ignoreRules.js";

export const sourceRouter = Router();

sourceRouter.get("/repos/:id/source", async (req, res) => {
  try {
    const repo = await getRepo(req.params.id);
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

    const content = await getFileContent(repo.id, relPath);
    if (content === null) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    res.json({ path: relPath, content });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load source" });
  }
});
