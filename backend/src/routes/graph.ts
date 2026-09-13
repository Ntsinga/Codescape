import { Router } from "express";
import { getRepo } from "../graph/queries.js";
import { getAllNodes, getAllEdges, getNode, getChildren, getEdgesForNode, searchNodes, getImpact } from "../graph/queries.js";
import type { EdgeType } from "../graph/types.js";

export const graphRouter = Router();

function requireReadyRepo(repoId: string, res: import("express").Response): boolean {
  const repo = getRepo(repoId);
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

graphRouter.get("/repos/:id/graph", (req, res) => {
  if (!requireReadyRepo(req.params.id, res)) return;
  res.json({ nodes: getAllNodes(req.params.id), edges: getAllEdges(req.params.id) });
});

graphRouter.get("/repos/:id/nodes/:nodeId", (req, res) => {
  if (!requireReadyRepo(req.params.id, res)) return;
  const node = getNode(req.params.nodeId);
  if (!node || node.repoId !== req.params.id) {
    res.status(404).json({ error: "Node not found" });
    return;
  }
  const children = getChildren(node.id, req.params.id);
  const edgeType = req.query.edgeType as EdgeType | undefined;
  const { incoming, outgoing } = getEdgesForNode(node.id, edgeType);
  res.json({ node, children, incoming, outgoing });
});

graphRouter.get("/repos/:id/nodes/:nodeId/children", (req, res) => {
  if (!requireReadyRepo(req.params.id, res)) return;
  res.json(getChildren(req.params.nodeId, req.params.id));
});

graphRouter.get("/repos/:id/search", (req, res) => {
  if (!requireReadyRepo(req.params.id, res)) return;
  const q = (req.query.q as string | undefined)?.trim();
  if (!q) {
    res.json([]);
    return;
  }
  res.json(searchNodes(req.params.id, q));
});

graphRouter.get("/repos/:id/nodes/:nodeId/impact", (req, res) => {
  if (!requireReadyRepo(req.params.id, res)) return;
  const node = getNode(req.params.nodeId);
  if (!node || node.repoId !== req.params.id) {
    res.status(404).json({ error: "Node not found" });
    return;
  }
  res.json({ node, impacted: getImpact(node.id, req.params.id) });
});
