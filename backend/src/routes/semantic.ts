import { Router } from "express";
import { getRepo, getAllNodes, getSemanticTree, saveSemanticTree } from "../graph/queries.js";
import { buildSemanticTree, type SemanticTree } from "../graph/semantic.js";
import { enrichSemanticTree } from "../ai/enrichSemantic.js";
import { computeStack } from "../graph/stack.js";

export const semanticRouter = Router();

semanticRouter.get("/repos/:id/stack", (req, res) => {
  const repo = getRepo(req.params.id);
  if (!repo) {
    res.status(404).json({ error: "Repository not found" });
    return;
  }
  res.json(computeStack(repo.id));
});

/** Returns the stored semantic tree, building a deterministic one on the fly if absent. */
semanticRouter.get("/repos/:id/semantic", (req, res) => {
  const repo = getRepo(req.params.id);
  if (!repo) {
    res.status(404).json({ error: "Repository not found" });
    return;
  }
  const stored = getSemanticTree(repo.id);
  if (stored) {
    res.json({ ...stored.tree, aiEnriched: stored.enriched });
    return;
  }
  const tree = buildSemanticTree(repo.name, getAllNodes(repo.id));
  saveSemanticTree(repo.id, tree, false);
  res.json(tree);
});

/**
 * (Re)builds the deterministic tree and, when enrich=true and an API key is set,
 * runs the AI naming pass on top. Falls back gracefully to the deterministic tree
 * if enrichment fails so the client always gets a usable map.
 */
semanticRouter.post("/repos/:id/decompose", async (req, res) => {
  const repo = getRepo(req.params.id);
  if (!repo) {
    res.status(404).json({ error: "Repository not found" });
    return;
  }
  if (repo.status !== "ready") {
    res.status(409).json({ error: `Repository is ${repo.status}`, status: repo.status });
    return;
  }

  let tree: SemanticTree = buildSemanticTree(repo.name, getAllNodes(repo.id));
  const wantEnrich = req.query.enrich !== "false";

  if (wantEnrich) {
    try {
      tree = await enrichSemanticTree(repo.name, tree);
    } catch (err) {
      saveSemanticTree(repo.id, tree, false);
      res.status(200).json({ ...tree, aiEnriched: false, enrichmentError: err instanceof Error ? err.message : "AI enrichment failed" });
      return;
    }
  }

  saveSemanticTree(repo.id, tree, tree.aiEnriched);
  res.json(tree);
});
