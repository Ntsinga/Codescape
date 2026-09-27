import type { GraphEdge, GraphNode } from "./types.js";
import {
  CONFIG_EXT,
  DOC_EXT,
  classifyRole,
  finalizeCounts,
  type Archetype,
  type EntryPoint,
  type NodeMetrics,
  type SemanticLink,
  type SemanticNode,
  type SemanticTree,
} from "./semantic.js";
import { classifyPackage } from "./packages.js";
import { computeRisks } from "./risk.js";

/**
 * The architecture pass: turns the semantic tree into something the 3D map can
 * draw as a *system* rather than a file tree. It decides what each node is
 * (archetype), where it sits vertically (layer), how parts depend on each other
 * (aggregated links), which third-party systems it talks to (External nodes),
 * where requests enter (entry points), and a few health metrics.
 *
 * Pure: callers supply the physical graph and the handful of sources needed for
 * entry-point detection.
 */

/** v2: folder-based subgroups (stored trees are regrouped on load, keeping AI concepts). */
export const ARCHITECTURE_VERSION = 2;

/** Vertical layer per archetype: user-facing at the top, external systems at the bottom. */
export const LAYER_OF: Partial<Record<Archetype, number>> = {
  Interface: 0,
  Gateway: 1,
  Service: 2,
  Logic: 3,
  Data: 4,
  External: 5,
  Support: -1,
};

const LAYER_ORDER: Archetype[] = ["Interface", "Gateway", "Service", "Logic", "Data"];

/** Files that are program entries, so "nothing imports it" is expected. */
const ENTRY_FILE = /(^|\/)(index|main|server|app|program|manage|wsgi|asgi|cli|__main__|vite\.config|next\.config)\.[a-z]+$/i;
/** File-system-routed UI (Next.js/Nuxt/SvelteKit) is reached by the framework, not imports. */
const FS_ROUTED = /(^|\/)(pages|app|routes)\//i;

export function archetypeForRole(role: string | null, filePath: string | null): Archetype {
  if (filePath && (DOC_EXT.test(filePath) || CONFIG_EXT.test(filePath))) return "Support";
  switch (role) {
    case "Route":
    case "Controller":
    case "API Client":
      return "Gateway";
    case "UI":
      return "Interface";
    case "Service":
      return "Service";
    case "Data":
      return "Data";
    case "Test":
    case "Config":
      return "Support";
    default:
      return "Logic";
  }
}

/** Source files worth scanning for route declarations (keeps memory bounded on big repos). */
export function isEntrypointCandidate(filePath: string): boolean {
  const role = classifyRole(filePath);
  if (role === "UI" || role === "API Client" || role === "Test") return false;
  if (!/\.(ts|js|mjs|cjs|py|cs)$/i.test(filePath)) return false;
  return role === "Route" || role === "Controller" || ENTRY_FILE.test(filePath) || /(route|router|controller|endpoint|urls|views|api)/i.test(filePath);
}

export function computeArchitecture(tree: SemanticTree, nodes: GraphNode[], edges: GraphEdge[], sources: Map<string, string>): SemanticTree {
  // Idempotent: drop anything a previous pass added.
  const base = tree.nodes.filter((n) => n.type !== "External");
  const system = base.find((n) => n.type === "System");
  if (!system) return tree;

  // ---- External systems (databases + third-party services actually imported) ----
  const externals = new Map<string, SemanticNode>();
  const externalOfModule = new Map<string, string>();
  for (const n of nodes) {
    if (n.type !== "ImportedModule") continue;
    const info = classifyPackage(n.name);
    if (!info || (info.category !== "Database" && info.category !== "External Service")) continue;
    const id = `ext-${info.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    if (!externals.has(id)) {
      externals.set(id, {
        id,
        type: "External",
        name: info.name,
        rawName: info.name,
        kind: info.category,
        summary: info.category === "Database" ? `${info.name}: where the system stores data.` : `${info.name}: a third-party service this system calls.`,
        capability: null,
        role: null,
        confidence: 1,
        source: "deterministic",
        parentId: system.id,
        physicalNodeId: null,
        filePath: null,
        startLine: null,
        endLine: null,
        language: null,
        childCount: 0,
        evidence: [],
      });
    }
    externalOfModule.set(n.id, id);
  }

  const all: SemanticNode[] = [...base, ...externals.values()];
  const byId = new Map(all.map((n) => [n.id, n]));
  const children = new Map<string, SemanticNode[]>();
  for (const n of all) {
    if (!n.parentId) continue;
    (children.get(n.parentId) ?? children.set(n.parentId, []).get(n.parentId)!).push(n);
  }

  // ---- Physical → semantic resolution ----
  const physById = new Map(nodes.map((n) => [n.id, n]));
  const semanticOfPhysical = new Map<string, string>();
  for (const n of all) if (n.physicalNodeId && (n.type === "Unit" || n.type === "Function")) semanticOfPhysical.set(n.physicalNodeId, n.id);
  const resolve = (physId: string): string | null => {
    const direct = semanticOfPhysical.get(physId);
    if (direct) return direct;
    const ext = externalOfModule.get(physId);
    if (ext) return ext;
    const fileId = physById.get(physId)?.fileId;
    return fileId ? semanticOfPhysical.get(fileId) ?? null : null;
  };

  const chainCache = new Map<string, string[]>();
  const chain = (id: string): string[] => {
    const hit = chainCache.get(id);
    if (hit) return hit;
    const out: string[] = [];
    let cur = byId.get(id);
    while (cur) {
      out.push(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    chainCache.set(id, out);
    return out;
  };
  const depth = (id: string) => chain(id).length - 1;

  // ---- Aggregated links ----
  const linkMap = new Map<string, SemanticLink & { inferred: number }>();
  const referencedFromOutside = new Map<string, number>();
  for (const e of edges) {
    if (e.type !== "Imports" && e.type !== "Calls") continue;
    const sa = resolve(e.fromNodeId);
    const sb = resolve(e.toNodeId);
    if (!sa || !sb || sa === sb) continue;
    const ca = chain(sa);
    const cb = chain(sb);
    const inB = new Set(cb);
    const lcaIdx = ca.findIndex((id) => inB.has(id));
    if (lcaIdx <= 0) continue; // one end contains the other
    const lca = ca[lcaIdx];
    const belowA = ca.slice(0, lcaIdx);
    const belowB = cb.slice(0, cb.indexOf(lca));
    if (belowB.length === 0) continue;
    for (const y of belowB) referencedFromOutside.set(y, (referencedFromOutside.get(y) ?? 0) + 1);

    for (const x of belowA) {
      for (const y of belowB) {
        const sibling = byId.get(x)!.parentId === byId.get(y)!.parentId;
        const context = !sibling && (depth(x) === 1 || depth(y) === 1);
        if (!sibling && !context) continue;
        const key = `${x}>${y}`;
        let link = linkMap.get(key);
        if (!link) {
          link = { from: x, to: y, weight: 0, imports: 0, calls: 0, inferredShare: 0, inferred: 0, scope: sibling ? "sibling" : "context" };
          linkMap.set(key, link);
        }
        link.weight++;
        if (e.type === "Imports") link.imports++;
        else link.calls++;
        if (e.confidence === "framework-derived") link.inferred++;
      }
    }
  }
  const links: SemanticLink[] = [...linkMap.values()].map(({ inferred, ...l }) => ({ ...l, inferredShare: l.weight ? inferred / l.weight : 0 }));

  // ---- Entry points ----
  const fileNodeByPath = new Map<string, GraphNode>();
  const functionsByFile = new Map<string, GraphNode[]>();
  for (const n of nodes) {
    if (n.type === "File" && n.filePath) fileNodeByPath.set(n.filePath, n);
    if (n.type === "Function" && n.fileId) (functionsByFile.get(n.fileId) ?? functionsByFile.set(n.fileId, []).get(n.fileId)!).push(n);
  }
  const entrypoints: EntryPoint[] = [];
  for (const [filePath, text] of sources) {
    const fileNode = fileNodeByPath.get(filePath);
    if (!fileNode) continue;
    const hits = findRoutes(filePath, text);
    const totalLines = text.split("\n").length;
    hits.forEach((hit, i) => {
      const endLine = i + 1 < hits.length ? Math.max(hit.line, hits[i + 1].line - 1) : totalLines;
      const enclosing = (functionsByFile.get(fileNode.id) ?? [])
        .filter((f) => f.startLine !== null && f.endLine !== null && f.startLine <= hit.line && f.endLine >= hit.line)
        .sort((a, b) => (a.endLine! - a.startLine!) - (b.endLine! - b.startLine!))[0];
      entrypoints.push({
        id: `ep-${fileNode.id}-${hit.line}`,
        label: `${hit.method} ${hit.path}`,
        method: hit.method,
        path: hit.path,
        filePath,
        line: hit.line,
        endLine,
        functionNodeId: enclosing?.id ?? null,
        fileNodeId: fileNode.id,
        semanticId: resolve(enclosing?.id ?? fileNode.id),
      });
    });
  }

  // ---- Archetypes + layers (bottom-up so Groups/Concepts see their files) ----
  const unitArchetypes = new Map<string, Archetype[]>(); // node id → archetypes of all descendant units
  const collectUnits = (n: SemanticNode): Archetype[] => {
    const cached = unitArchetypes.get(n.id);
    if (cached) return cached;
    let list: Archetype[] = [];
    if (n.type === "Unit") list = [archetypeForRole(n.role, n.filePath)];
    else for (const c of children.get(n.id) ?? []) list = list.concat(collectUnits(c));
    unitArchetypes.set(n.id, list);
    return list;
  };
  const dominant = (list: Archetype[]): Archetype => {
    const counts = new Map<Archetype, number>();
    for (const a of list) if (a !== "Support") counts.set(a, (counts.get(a) ?? 0) + 1);
    if (counts.size === 0) return list.length ? "Support" : "Logic";
    let best: Archetype = "Logic";
    let bestN = -1;
    for (const a of LAYER_ORDER) {
      const c = counts.get(a) ?? 0;
      if (c > bestN) { best = a; bestN = c; }
    }
    return best;
  };

  for (const n of all) {
    let archetype: Archetype;
    let layerArchetype: Archetype | null;
    switch (n.type) {
      case "System": archetype = "System"; layerArchetype = null; break;
      case "External": archetype = "External"; layerArchetype = "External"; break;
      case "Unit": archetype = archetypeForRole(n.role, n.filePath); layerArchetype = archetype; break;
      case "Group": archetype = dominant(collectUnits(n)); layerArchetype = archetype; break;
      case "Concept": archetype = "Domain"; layerArchetype = n.architecturalKind ?? dominant(collectUnits(n)); break;
      case "Function": {
        const parent = n.parentId ? byId.get(n.parentId) : undefined;
        archetype = "Function";
        layerArchetype = parent ? archetypeForRole(parent.role, parent.filePath) : "Logic";
        break;
      }
      default: archetype = "Logic"; layerArchetype = "Logic";
    }
    n.archetype = archetype;
    n.layerArchetype = layerArchetype ?? undefined;
    n.layer = layerArchetype ? LAYER_OF[layerArchetype] ?? 3 : null;
  }

  // ---- Metrics ----
  const risks = computeRisks(nodes, edges);
  const riskByFile = new Map<string, { score: number; reasons: string[] }>();
  for (const pn of nodes) {
    const r = risks.get(pn.id);
    if (!r || !pn.fileId) continue;
    const cur = riskByFile.get(pn.fileId);
    if (!cur || r.score > cur.score) riskByFile.set(pn.fileId, { score: r.score, reasons: r.reasons.map((x) => `${pn.name}: ${x}`) });
  }
  const entryCountBySemantic = new Map<string, number>();
  for (const ep of entrypoints) {
    if (!ep.semanticId) continue;
    for (const id of chain(ep.semanticId)) entryCountBySemantic.set(id, (entryCountBySemantic.get(id) ?? 0) + 1);
  }

  const neighboursIn = new Map<string, Set<string>>();
  const neighboursOut = new Map<string, Set<string>>();
  for (const l of links) {
    (neighboursOut.get(l.from) ?? neighboursOut.set(l.from, new Set()).get(l.from)!).add(l.to);
    (neighboursIn.get(l.to) ?? neighboursIn.set(l.to, new Set()).get(l.to)!).add(l.from);
  }

  const metricsOf = new Map<string, NodeMetrics>();
  const computeMetrics = (n: SemanticNode): NodeMetrics => {
    const cached = metricsOf.get(n.id);
    if (cached) return cached;
    const kids = children.get(n.id) ?? [];
    const kidMetrics = kids.map(computeMetrics);
    let files = kidMetrics.reduce((s, m) => s + m.files, 0);
    let functions = kidMetrics.reduce((s, m) => s + m.functions, 0);
    let loc = kidMetrics.reduce((s, m) => s + m.loc, 0);
    let risk = 0;
    let riskReasons: string[] = [];
    for (const m of kidMetrics) if (m.risk > risk) { risk = m.risk; riskReasons = m.riskReasons; }
    if (n.type === "Unit") {
      files = 1;
      const r = n.physicalNodeId ? riskByFile.get(n.physicalNodeId) : undefined;
      if (r && r.score > risk) { risk = r.score; riskReasons = r.reasons; }
    }
    if (n.type === "Function") {
      functions = 1;
      loc = n.startLine !== null && n.endLine !== null ? n.endLine - n.startLine + 1 : 0;
      const r = n.physicalNodeId ? risks.get(n.physicalNodeId) : undefined;
      if (r) { risk = r.score; riskReasons = r.reasons; }
    }
    const fanIn = neighboursIn.get(n.id)?.size ?? 0;
    const fanOut = neighboursOut.get(n.id)?.size ?? 0;
    const entrypointCount = entryCountBySemantic.get(n.id) ?? 0;
    const archetype = n.archetype;
    const exemptFromUnused =
      n.type === "System" ||
      n.type === "External" ||
      n.type === "Function" ||
      archetype === "Support" ||
      entrypointCount > 0 ||
      (n.filePath !== null && (ENTRY_FILE.test(n.filePath) || (archetype === "Interface" && FS_ROUTED.test(n.filePath))));
    const m: NodeMetrics = {
      files,
      functions,
      loc,
      fanIn,
      fanOut,
      centrality: 0, // filled per sibling set below
      risk,
      riskReasons: riskReasons.slice(0, 4),
      isolated: n.type !== "System" && fanIn + fanOut === 0,
      unusedCandidate: !exemptFromUnused && (referencedFromOutside.get(n.id) ?? 0) === 0,
      entrypoints: entrypointCount,
    };
    metricsOf.set(n.id, m);
    return m;
  };
  computeMetrics(system);
  for (const n of all) n.metrics = computeMetrics(n);
  for (const kids of children.values()) {
    const max = Math.max(1, ...kids.map((k) => k.metrics!.fanIn + k.metrics!.fanOut));
    for (const k of kids) k.metrics!.centrality = (k.metrics!.fanIn + k.metrics!.fanOut) / max;
  }

  finalizeCounts(all);
  return { ...tree, nodes: all, links, entrypoints, architectureVersion: ARCHITECTURE_VERSION };
}

// ---- Route detection ----------------------------------------------------------

interface RouteHit {
  method: string;
  path: string;
  line: number;
}

const JS_ROUTE = /\b(?:router|app|server|fastify|\w+Router|\w+Routes|\w+App)\s*\.\s*(get|post|put|patch|delete|all|options|head)\s*\(\s*(['"`])([^'"`]+)\2/g;
const PY_DECORATOR = /@\s*[\w.]+\.(get|post|put|patch|delete|route|api_route)\(\s*(?:path\s*=\s*)?[rf]?['"]([^'"]*)['"]/g;
const PY_DJANGO = /\b(?:re_)?path\(\s*r?['"]([^'"]*)['"]\s*,/g;
const CS_ATTR = /\[Http(Get|Post|Put|Patch|Delete)(?:\(\s*"([^"]*)"\s*\))?\]/g;
const CS_MINIMAL = /\.Map(Get|Post|Put|Patch|Delete)\(\s*"([^"]+)"/g;

export function findRoutes(filePath: string, text: string): RouteHit[] {
  const lineAt = lineIndexer(text);
  const hits: RouteHit[] = [];
  const push = (re: RegExp, pick: (m: RegExpExecArray) => { method: string; path: string }) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) hits.push({ ...pick(m), line: lineAt(m.index) });
  };
  if (/\.py$/i.test(filePath)) {
    push(PY_DECORATOR, (m) => ({ method: m[1] === "route" || m[1] === "api_route" ? "ANY" : m[1].toUpperCase(), path: m[2] || "/" }));
    if (/urls\.py$/i.test(filePath)) push(PY_DJANGO, (m) => ({ method: "ANY", path: `/${m[1]}` }));
  } else if (/\.cs$/i.test(filePath)) {
    push(CS_ATTR, (m) => ({ method: m[1].toUpperCase(), path: m[2] ?? "(controller route)" }));
    push(CS_MINIMAL, (m) => ({ method: m[1].toUpperCase(), path: m[2] }));
  } else {
    push(JS_ROUTE, (m) => ({ method: m[1].toUpperCase(), path: m[3] }));
  }
  return hits.sort((a, b) => a.line - b.line);
}

/** Returns index → 1-based line lookup via binary search over newline offsets. */
function lineIndexer(text: string): (index: number) => number {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return (index) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}
