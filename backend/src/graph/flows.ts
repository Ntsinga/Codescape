import type { GraphEdge, GraphNode } from "./types.js";
import type { EntryPoint, SemanticTree } from "./semantic.js";
import { classifyPackage } from "./packages.js";

export interface FlowStep {
  /** Physical node id (Function/File), or an External semantic id for terminal steps. */
  nodeId: string;
  name: string;
  filePath: string | null;
  line: number | null;
  depth: number;
  /** Step this one was reached from (null for the handler's first calls). */
  parentNodeId: string | null;
  /** How the hop INTO this step is known. */
  confidence: "statically-confirmed" | "framework-derived" | "file-import";
  /** Semantic ancestor chain, deepest first (so the UI can map a step to whatever is visible). */
  semanticChain: string[];
}

export interface FlowResult {
  entrypoint: EntryPoint;
  steps: FlowStep[];
  /** Called names in the handler that didn't resolve to repo code (library calls, dynamic dispatch). */
  unresolvedCalls: string[];
  truncated: boolean;
  policy: string;
}

const MAX_DEPTH = 10;
const MAX_STEPS = 60;
const CALL_NAME = /\b([A-Za-z_$][\w$]*)\s*\(/g;
const NOT_CALLS = new Set(["if", "for", "while", "switch", "catch", "function", "return", "typeof", "await", "async", "new", "super", "require", "import"]);

/**
 * Traces what an entry point (a route) reaches, forward over Calls edges. It
 * starts from the calls that appear inside the handler's own lines, so an inline
 * `router.post("/x", async () => {...})` traces only that handler, not the whole
 * file. Externals are attached where a visited file imports a database/service
 * package — marked "file-import" because it's a file-level fact, not a call.
 * Never invents steps: unresolved calls end the path and are listed.
 */
export function traceFlow(entry: EntryPoint, tree: SemanticTree, nodes: GraphNode[], edges: GraphEdge[], fileText: string | null): FlowResult {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const callsFrom = new Map<string, GraphEdge[]>();
  const importsFrom = new Map<string, GraphEdge[]>();
  for (const e of edges) {
    if (e.type === "Calls") (callsFrom.get(e.fromNodeId) ?? callsFrom.set(e.fromNodeId, []).get(e.fromNodeId)!).push(e);
    else if (e.type === "Imports") (importsFrom.get(e.fromNodeId) ?? importsFrom.set(e.fromNodeId, []).get(e.fromNodeId)!).push(e);
  }

  // Semantic chain lookup.
  const semById = new Map(tree.nodes.map((n) => [n.id, n]));
  const semOfPhysical = new Map<string, string>();
  for (const n of tree.nodes) if (n.physicalNodeId && (n.type === "Unit" || n.type === "Function")) semOfPhysical.set(n.physicalNodeId, n.id);
  const chainOf = (semId: string | null | undefined): string[] => {
    const out: string[] = [];
    let cur = semId ? semById.get(semId) : undefined;
    while (cur) {
      out.push(cur.id);
      cur = cur.parentId ? semById.get(cur.parentId) : undefined;
    }
    return out;
  };
  const semanticChainFor = (physId: string) => {
    const direct = semOfPhysical.get(physId);
    if (direct) return chainOf(direct);
    const fileId = byId.get(physId)?.fileId;
    return chainOf(fileId ? semOfPhysical.get(fileId) : null);
  };

  // ---- Handler: the calls written inside the route's own lines ----
  const fileFunctions = nodes.filter((n) => n.fileId === entry.fileNodeId && n.type === "Function" && n.startLine !== null && n.endLine !== null);
  // Decorator/attribute style (Python, C#): the handler is the function right below the route line.
  const decorated = fileFunctions.find((f) => f.startLine! > entry.line && f.startLine! <= entry.line + 3);
  const callers = new Set<string>();
  let names: Set<string> | null = null;
  if (decorated) {
    callers.add(decorated.id);
  } else {
    callers.add(entry.fileNodeId);
    if (entry.functionNodeId) callers.add(entry.functionNodeId);
    for (const f of fileFunctions) if (f.startLine! >= entry.line && f.endLine! <= entry.endLine) callers.add(f.id);
    if (fileText) {
      names = new Set<string>();
      const slice = fileText
        .split("\n")
        .slice(entry.line - 1, entry.endLine)
        .join("\n")
        .replace(/\/\*[\s\S]*?\*\//g, "") // comments mention names that aren't calls
        .replace(/(^|[^:])\/\/.*$/gm, "$1")
        .replace(entry.filePath.endsWith(".py") ? /#.*$/gm : /$^/, "");
      CALL_NAME.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = CALL_NAME.exec(slice))) if (!NOT_CALLS.has(m[1])) names.add(m[1]);
    }
  }
  const shortName = (n: GraphNode | undefined) => (n ? n.name.split(".").pop()! : "");

  const steps: FlowStep[] = [];
  const seen = new Set<string>();
  const queue: Array<{ id: string; depth: number; parent: string | null; confidence: FlowStep["confidence"] }> = [];
  const resolvedNames = new Set<string>();
  for (const c of callers) {
    for (const e of callsFrom.get(c) ?? []) {
      const target = byId.get(e.toNodeId);
      if (!target) continue;
      if (names && !names.has(shortName(target))) continue; // call belongs to a different handler in this file
      resolvedNames.add(shortName(target));
      if (!seen.has(target.id)) {
        seen.add(target.id);
        queue.push({ id: target.id, depth: 1, parent: decorated?.id ?? null, confidence: e.confidence });
      }
    }
  }

  let truncated = false;
  const visitedFiles = new Map<string, string>(); // fileId → first step id in that file
  while (queue.length) {
    const cur = queue.shift()!;
    if (steps.length >= MAX_STEPS) { truncated = true; break; }
    const node = byId.get(cur.id);
    if (!node) continue;
    steps.push({
      nodeId: node.id,
      name: node.name,
      filePath: node.filePath,
      line: node.startLine,
      depth: cur.depth,
      parentNodeId: cur.parent,
      confidence: cur.confidence,
      semanticChain: semanticChainFor(node.id),
    });
    if (node.fileId && !visitedFiles.has(node.fileId)) visitedFiles.set(node.fileId, node.id);
    if (cur.depth >= MAX_DEPTH) { if ((callsFrom.get(node.id) ?? []).length) truncated = true; continue; }
    for (const e of callsFrom.get(node.id) ?? []) {
      if (seen.has(e.toNodeId)) continue;
      seen.add(e.toNodeId);
      queue.push({ id: e.toNodeId, depth: cur.depth + 1, parent: node.id, confidence: e.confidence });
    }
  }

  // ---- Externals touched by visited files (file-level import, marked as such) ----
  if (!visitedFiles.has(entry.fileNodeId)) visitedFiles.set(entry.fileNodeId, decorated?.id ?? entry.fileNodeId);
  const addedExternal = new Set<string>();
  for (const [fileId, viaStep] of visitedFiles) {
    for (const e of importsFrom.get(fileId) ?? []) {
      const mod = byId.get(e.toNodeId);
      if (!mod || mod.type !== "ImportedModule") continue;
      const info = classifyPackage(mod.name);
      if (!info || (info.category !== "Database" && info.category !== "External Service")) continue;
      const extId = `ext-${info.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      if (addedExternal.has(extId) || !semById.has(extId)) continue;
      addedExternal.add(extId);
      const via = steps.find((s) => s.nodeId === viaStep);
      steps.push({
        nodeId: extId,
        name: info.name,
        filePath: null,
        line: null,
        depth: (via?.depth ?? 0) + 1,
        parentNodeId: via ? via.nodeId : null,
        confidence: "file-import",
        semanticChain: chainOf(extId),
      });
    }
  }

  const unresolvedCalls = names ? [...names].filter((n) => !resolvedNames.has(n)).slice(0, 30) : [];
  return {
    entrypoint: entry,
    steps,
    unresolvedCalls,
    truncated,
    policy: "Inferred from static analysis: calls are matched by name, so this shows what the handler can reach, not a recorded execution.",
  };
}
