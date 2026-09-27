import { Router } from "express";
import { getRepoForUser, getAllNodes, getAllEdges, getSemanticTree, saveSemanticTree, getFileContentsByPaths, getFileContent } from "../graph/queries.js";
import { buildSemanticTree, addSubgroups, removeSubgroups, buildFileAdjacency, type SemanticTree } from "../graph/semantic.js";
import { enrichSemanticTree } from "../ai/enrichSemantic.js";
import { computeStack } from "../graph/stack.js";
import { ARCHITECTURE_VERSION, computeArchitecture, isEntrypointCandidate } from "../graph/architecture.js";
import { getAuth } from "../auth.js";
import type { GraphEdge, GraphNode } from "../graph/types.js";
import { traceFlow } from "../graph/flows.js";
import { explainSemanticNode } from "../ai/explainSemantic.js";
import { getHistory, isCollectingHistory } from "../graph/history.js";

export const semanticRouter = Router();

/**
 * Deterministic clustering of files that import/call each other, tests, docs,
 * config — then the architecture pass (archetypes, layers, links, externals,
 * entry points, metrics) that the 3D map draws.
 */
async function withSubgroups(repoId: string, tree: SemanticTree): Promise<SemanticTree> {
  const nodes = await getAllNodes(repoId);
  const edges = await getAllEdges(repoId);
  return withArchitecture(repoId, addSubgroups(tree, buildFileAdjacency(nodes, edges)), nodes, edges);
}

async function withArchitecture(repoId: string, tree: SemanticTree, nodes?: GraphNode[], edges?: GraphEdge[]): Promise<SemanticTree> {
  const allNodes = nodes ?? (await getAllNodes(repoId));
  const allEdges = edges ?? (await getAllEdges(repoId));
  const candidates = allNodes.filter((n) => n.type === "File" && n.filePath && isEntrypointCandidate(n.filePath)).map((n) => n.filePath!);
  const sources = await getFileContentsByPaths(repoId, candidates.slice(0, 300));
  return computeArchitecture(tree, allNodes, allEdges, sources);
}

semanticRouter.get("/repos/:id/stack", async (req, res) => {
  try {
    const repo = await getRepoForUser(req.params.id, getAuth(req).userId!);
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
    const repo = await getRepoForUser(req.params.id, getAuth(req).userId!);
    if (!repo) {
      res.status(404).json({ error: "Repository not found" });
      return;
    }
    const stored = await getSemanticTree(repo.id);
    if (stored) {
      // Trees saved before the architecture pass existed (or by an older version) get it now.
      const tree = (await loadArchitectedTree(repo.id))!;
      res.json({ ...tree, aiEnriched: stored.enriched });
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
    const repo = await getRepoForUser(req.params.id, getAuth(req).userId!);
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

/** Loads the stored tree with the architecture pass applied (entry points, links). */
async function loadArchitectedTree(repoId: string): Promise<SemanticTree | null> {
  const stored = await getSemanticTree(repoId);
  if (!stored) return null;
  let tree = stored.tree as SemanticTree;
  if (tree.architectureVersion !== ARCHITECTURE_VERSION) {
    // Older trees: regroup (grouping rules changed) and rerun the architecture pass. AI concepts are kept.
    const flat = removeSubgroups(tree);
    tree = await withSubgroups(repoId, { ...flat, nodes: flat.nodes.filter((n) => n.type !== "External") });
    await saveSemanticTree(repoId, tree, stored.enriched);
  }
  return tree;
}

/** Traces what a detected route reaches (static, name-matched — the response says so). */
semanticRouter.get("/repos/:id/flows/:entrypointId", async (req, res) => {
  try {
    const repo = await getRepoForUser(req.params.id, getAuth(req).userId!);
    if (!repo) {
      res.status(404).json({ error: "Repository not found" });
      return;
    }
    const tree = await loadArchitectedTree(repo.id);
    const entry = tree?.entrypoints?.find((e) => e.id === req.params.entrypointId);
    if (!tree || !entry) {
      res.status(404).json({ error: "Entry point not found" });
      return;
    }
    const text = await getFileContent(repo.id, entry.filePath);
    res.json(traceFlow(entry, tree, await getAllNodes(repo.id), await getAllEdges(repo.id), text));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to trace flow" });
  }
});

/** "Why does this exist?" for a map node: deterministic relationships + AI purpose. */
semanticRouter.post("/repos/:id/semantic/:nodeId/explain", async (req, res) => {
  try {
    const repo = await getRepoForUser(req.params.id, getAuth(req).userId!);
    if (!repo) {
      res.status(404).json({ error: "Repository not found" });
      return;
    }
    const tree = await loadArchitectedTree(repo.id);
    if (!tree || !tree.nodes.some((n) => n.id === req.params.nodeId)) {
      res.status(404).json({ error: "Node not found" });
      return;
    }
    res.json(await explainSemanticNode(tree, req.params.nodeId));
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Explanation failed" });
  }
});

/** Per-file git history for the timeline; explains why when there is none. */
semanticRouter.get("/repos/:id/history", async (req, res) => {
  try {
    const repo = await getRepoForUser(req.params.id, getAuth(req).userId!);
    if (!repo) {
      res.status(404).json({ error: "Repository not found" });
      return;
    }
    if (repo.origin.kind !== "github") {
      res.json({ available: false, reason: "Only GitHub imports have history — a zip upload is a single snapshot.", files: {} });
      return;
    }
    const history = await getHistory(repo.id);
    if (isCollectingHistory(repo.id)) {
      res.json({ ...(history ?? { files: {} }), available: history?.available ?? false, collecting: true, reason: history?.available ? undefined : "Collecting git history…" });
      return;
    }
    res.json(history ?? { available: false, reason: "History not collected yet.", canCollect: true, files: {} });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load history" });
  }
});
