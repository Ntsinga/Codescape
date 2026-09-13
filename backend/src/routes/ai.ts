import { Router } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { getRepo, getNode, getEdgesForNode, getAllNodes, getAllEdges } from "../graph/queries.js";
import { repoSourceDir } from "../storage/paths.js";
import { isSecretLike } from "../ingestion/ignoreRules.js";
import { explainNode, analyzeArchitecture } from "../ai/openai.js";
import { availableProviders, getSelection, setSelection, listModels, type ProviderName } from "../ai/provider.js";

export const aiRouter = Router();

aiRouter.get("/ai/status", (_req, res) => {
  const providers = availableProviders();
  res.json({ providers, current: getSelection(), enabled: providers.length > 0 });
});

aiRouter.get("/ai/models", async (_req, res) => {
  try {
    const models = await listModels();
    res.json({ providers: availableProviders(), models, current: getSelection() });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to list models" });
  }
});

aiRouter.post("/ai/select", (req, res) => {
  const provider = String(req.body?.provider ?? "") as ProviderName;
  const model = String(req.body?.model ?? "");
  if (provider !== "openai" && provider !== "gemini") {
    res.status(400).json({ error: "provider must be 'openai' or 'gemini'" });
    return;
  }
  if (!availableProviders().includes(provider)) {
    res.status(400).json({ error: `${provider} has no API key configured` });
    return;
  }
  setSelection(provider, model);
  res.json({ current: getSelection() });
});

async function readSnippet(repoId: string, filePath: string, startLine: number, endLine: number): Promise<string> {
  const root = repoSourceDir(repoId);
  const full = path.resolve(root, filePath);
  const text = await fs.readFile(full, "utf-8");
  const lines = text.split(/\r?\n/);
  return lines.slice(Math.max(0, startLine - 1), endLine).join("\n");
}

aiRouter.post("/repos/:id/nodes/:nodeId/explain", async (req, res) => {
  const repo = getRepo(req.params.id);
  if (!repo) {
    res.status(404).json({ error: "Repository not found" });
    return;
  }
  const node = getNode(req.params.nodeId);
  if (!node || node.repoId !== repo.id) {
    res.status(404).json({ error: "Node not found" });
    return;
  }
  if (!node.filePath || node.startLine === null || node.endLine === null) {
    res.status(400).json({ error: "This node type has no source range to explain" });
    return;
  }
  if (isSecretLike(node.filePath)) {
    res.status(403).json({ error: "This file is excluded as potentially sensitive" });
    return;
  }

  try {
    const code = await readSnippet(repo.id, node.filePath, node.startLine, node.endLine);

    const { outgoing } = getEdgesForNode(node.id, "Imports");
    const importSnippets: { filePath: string; startLine: number; endLine: number; code: string }[] = [];
    for (const edge of outgoing.slice(0, 3)) {
      const target = getNode(edge.toNodeId);
      if (target?.filePath && target.startLine !== null && target.endLine !== null && !isSecretLike(target.filePath)) {
        const snippetCode = await readSnippet(repo.id, target.filePath, target.startLine, Math.min(target.endLine, target.startLine + 20));
        importSnippets.push({ filePath: target.filePath, startLine: target.startLine, endLine: target.endLine, code: snippetCode });
      }
    }

    const result = await explainNode({
      nodeName: node.name,
      nodeType: node.type,
      code,
      filePath: node.filePath,
      startLine: node.startLine,
      endLine: node.endLine,
      importSnippets,
    });
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "AI explanation failed" });
  }
});

aiRouter.post("/repos/:id/analyze", async (req, res) => {
  const repo = getRepo(req.params.id);
  if (!repo) { res.status(404).json({ error: "Repository not found" }); return; }
  if (repo.status !== "ready") { res.status(409).json({ error: `Repository is ${repo.status}` }); return; }
  try {
    const result = await analyzeArchitecture({ repoName: repo.name, nodes: getAllNodes(repo.id), edges: getAllEdges(repo.id) });
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Architecture analysis failed" });
  }
});

aiRouter.get("/repos/:id/diagrams", (req, res) => {
  const repo = getRepo(req.params.id);
  if (!repo) { res.status(404).json({ error: "Repository not found" }); return; }
  const nodes = getAllNodes(repo.id);
  const edges = getAllEdges(repo.id);
  const components = nodes.filter((n) => ["Folder", "File", "Class", "Interface", "Function"].includes(n.type)).slice(0, 300);
  res.json({
    diagrams: [
      { type: "component", title: "Repository component map", nodes: components, edges: edges.filter((e) => ["Contains", "Imports", "Calls"].includes(e.type)).slice(0, 600) },
      { type: "dependency", title: "Module dependency graph", nodes: nodes.filter((n) => ["File", "ImportedModule"].includes(n.type)), edges: edges.filter((e) => e.type === "Imports") },
    ],
    evidencePolicy: "Generated from statically-confirmed and framework-derived graph relationships.",
  });
});

aiRouter.get("/repos/:id/risks", (req, res) => {
  const repo = getRepo(req.params.id);
  if (!repo) { res.status(404).json({ error: "Repository not found" }); return; }
  const nodes = getAllNodes(repo.id);
  const edges = getAllEdges(repo.id);
  const risks = nodes.filter((n) => n.filePath && n.startLine !== null && n.endLine !== null).map((node) => {
    const incoming = edges.filter((e) => e.toNodeId === node.id && ["Calls", "Imports"].includes(e.type)).length;
    const outgoing = edges.filter((e) => e.fromNodeId === node.id && ["Calls", "Imports"].includes(e.type)).length;
    const lines = (node.endLine ?? 0) - (node.startLine ?? 0) + 1;
    const score = Math.min(100, incoming * 8 + outgoing * 4 + Math.max(0, lines - 40));
    return { node, score, reasons: [incoming > 2 ? `${incoming} incoming dependencies` : null, outgoing > 4 ? `${outgoing} outgoing dependencies` : null, lines > 80 ? `${lines} source lines` : null].filter(Boolean) };
  }).filter((r) => r.score >= 20).sort((a, b) => b.score - a.score).slice(0, 50);
  res.json({ risks, policy: "Deterministic baseline score; review with source evidence before acting." });
});
