import { Router } from "express";
import { getRepoForUser, listReposForUser, deleteRepo } from "../graph/queries.js";
import { getAuth } from "../auth.js";

export const reposRouter = Router();

reposRouter.delete("/repos/:id", async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const repo = await getRepoForUser(req.params.id, userId!);
    if (!repo) {
      res.status(404).json({ error: "Repository not found" });
      return;
    }
    await deleteRepo(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to delete repository" });
  }
});

reposRouter.get("/repos", async (req, res) => {
  try {
    const { userId } = getAuth(req);
    res.json(await listReposForUser(userId!));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to list repositories" });
  }
});

reposRouter.get("/repos/:id", async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const repo = await getRepoForUser(req.params.id, userId!);
    if (!repo) {
      res.status(404).json({ error: "Repository not found" });
      return;
    }
    res.json(repo);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load repository" });
  }
});
