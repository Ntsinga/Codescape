import { Router } from "express";
import { getRepo, listRepos } from "../graph/queries.js";

export const reposRouter = Router();

reposRouter.get("/repos", (_req, res) => {
  res.json(listRepos());
});

reposRouter.get("/repos/:id", (req, res) => {
  const repo = getRepo(req.params.id);
  if (!repo) {
    res.status(404).json({ error: "Repository not found" });
    return;
  }
  res.json(repo);
});
