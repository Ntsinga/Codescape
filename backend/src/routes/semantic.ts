import { Router } from "express";
import { getRepo, getAllNodes, getAllEdges, getSemanticTree, saveSemanticTree } from "../graph/queries.js";
import { buildSemanticTree, addSubgroups, buildFileAdjacency, type SemanticTree } from "../graph/semantic.js";
import { enrichSemanticTree } from "../ai/enrichSemantic.js";
import { computeStack } from "../graph/stack.js";

export const semanticRouter = Router();

/** Deterministic clustering of files that import/call each other, tests, docs, config. */
async function withSubgroups(repoId: string, tree: SemanticTree): Promise<SemanticTree> {
  return addSubgroups(tree, buildFileAdjacency(await getAllNodes(repoId), await getAllEdges(repoId)));
}

semanticRouter.get("/repos/:id/stack", async (req, res) => {
  try {
    const repo = await getRepo(req.params.id);
    if (!repo) {
      res.status(404).json({ error: "Repository not found" });
      return;
    }
    res.json(await computeStack(repo.id));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to compute tech stack" });
  }
});

/** Returns the stored semantic tree, building a deterministic one on the fly if absent. */
semanticRouter.get("/repos/:id/semantic", async (req, res) => {
  try {
    const repo = await getRepo(req.params.id);
    if (!repo) {
      res.status(404).json({ error: "Repository not found" });
      return;
    }
    const stored = await getSemanticTree(repo.id);
    if (stored) {
      res.json({ ...stored.tree, aiEnriched: stored.enriched });
      return;
    }
    const tree = await withSubgroups(repo.id, buildSemanticTree(repo.name, await getAllNodes(repo.id)));
    await saveSemanticTree(repo.id, tree, false);
    res.json(tree);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load semantic map" });
  }
});

/**
 * (Re)builds the deterministic tree and, when enrich=true and an API key is set,
 * runs the AI naming pass on top. Falls back gracefully to the deterministic tree
 * if enrichment fails so the client always gets a usable map.
 */
semanticRouter.post("/repos/:id/decompose", async (req, res) => {
  try {
    const repo = await getRepo(req.params.id);
    if (!repo) {
      res.status(404).json({ error: "Repository not found" });
      return;
    }
    if (repo.status !== "ready") {
      res.status(409).json({ error: `Repository is ${repo.status}`, status: repo.status });
      return;
    }

    let tree: SemanticTree = buildSemanticTree(repo.name, await getAllNodes(repo.id));
    const wantEnrich = req.query.enrich !== "false";

    if (wantEnrich) {
      try {
        tree = await enrichSemanticTree(repo.name, tree);
      } catch (err) {
        const grouped = await withSubgroups(repo.id, tree);
        await saveSemanticTree(repo.id, grouped, false);
        res.status(200).json({ ...grouped, aiEnriched: false, enrichmentError: err instanceof Error ? err.message : "AI enrichment failed" });
        return;
      }
    }

    tree = await withSubgroups(repo.id, tree);
    await saveSemanticTree(repo.id, tree, tree.aiEnriched);
    res.json(tree);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to decompose repository" });
  }
});
