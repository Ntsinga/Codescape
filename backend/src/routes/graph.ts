import { Router } from "express";
import { getRepo, getAllNodes, getAllEdges, getNode, getChildren, getEdgesForNode, searchNodes, getImpact } from "../graph/queries.js";
import type { EdgeType } from "../graph/types.js";

export const graphRouter = Router();

async function requireReadyRepo(repoId: string, res: import("express").Response): Promise<boolean> {
  const repo = await getRepo(repoId);
  if (!repo) {
    res.status(404).json({ error: "Repository not found" });
    return false;
  }
  if (repo.status !== "ready") {
    res.status(409).json({ error: `Repository is ${repo.status}`, status: repo.status });
    return false;
  }
  return true;
}

graphRouter.get("/repos/:id/graph", async (req, res) => {
  try {
    if (!(await requireReadyRepo(req.params.id, res))) return;
    res.json({ nodes: await getAllNodes(req.params.id), edges: await getAllEdges(req.params.id) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load graph" });
  }
});

graphRouter.get("/repos/:id/nodes/:nodeId", async (req, res) => {
  try {
    if (!(await requireReadyRepo(req.params.id, res))) return;
    const node = await getNode(req.params.nodeId);
    if (!node || node.repoId !== req.params.id) {
      res.status(404).json({ error: "Node not found" });
      return;
    }
    const children = await getChildren(node.id, req.params.id);
    const edgeType = req.query.edgeType as EdgeType | undefined;
    const { incoming, outgoing } = await getEdgesForNode(node.id, edgeType);
    res.json({ node, children, incoming, outgoing });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load node" });
  }
});

graphRouter.get("/repos/:id/nodes/:nodeId/children", async (req, res) => {
  try {
    if (!(await requireReadyRepo(req.params.id, res))) return;
    res.json(await getChildren(req.params.nodeId, req.params.id));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load children" });
  }
});

graphRouter.get("/repos/:id/search", async (req, res) => {
  try {
    if (!(await requireReadyRepo(req.params.id, res))) return;
    const q = (req.query.q as string | undefined)?.trim();
    if (!q) {
      res.json([]);
      return;
    }
    res.json(await searchNodes(req.params.id, q));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Search failed" });
  }
});

graphRouter.get("/repos/:id/nodes/:nodeId/impact", async (req, res) => {
  try {
    if (!(await requireReadyRepo(req.params.id, res))) return;
    const node = await getNode(req.params.nodeId);
    if (!node || node.repoId !== req.params.id) {
      res.status(404).json({ error: "Node not found" });
      return;
    }
    res.json({ node, impacted: await getImpact(node.id, req.params.id) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to compute impact" });
  }
});
