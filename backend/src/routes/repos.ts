import { Router } from "express";
import { getRepo, listRepos } from "../graph/queries.js";

export const reposRouter = Router();

reposRouter.get("/repos", async (_req, res) => {
  try {
    res.json(await listRepos());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to list repositories" });
  }
});

reposRouter.get("/repos/:id", async (req, res) => {
  try {
    const repo = await getRepo(req.params.id);
    if (!repo) {
      res.status(404).json({ error: "Repository not found" });
      return;
    }
    res.json(repo);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load repository" });
  }
});
