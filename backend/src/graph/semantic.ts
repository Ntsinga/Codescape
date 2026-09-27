import { nanoid } from "nanoid";
import type { GraphNode, GraphEdge } from "./types.js";

/**
 * Roles in the CONCEPTUAL map. The map is meant to be understood
 * conceptually first (what the system does) and technically second (how):
 *
 *   System  → what the whole application is
 *     Concept → a capability / responsibility area (AI-grouped by meaning,
 *               deterministically by top-level area as a fallback)
 *       Unit  → a source file that implements part of that concept
 *         Function → a function/method inside it
 *           → source code
 *
 * The raw directory/file structure lives in the separate physical "Files" layer;
 * this layer is the meaning-oriented view.
 */
export type SemanticType = "System" | "Concept" | "Group" | "Unit" | "Function" | "External";

/** What a node IS architecturally — drives its 3D form (see graph/architecture.ts). */
export type Archetype =
  | "System"
  | "Domain"
  | "Interface"
  | "Gateway"
  | "Service"
  | "Logic"
  | "Data"
  | "External"
  | "Support"
  | "Function";

export interface NodeMetrics {
  files: number;
  functions: number;
  /** Lines covered by functions (a proxy for size; whole-file LOC isn't stored). */
  loc: number;
  /** Distinct neighbours depending on / depended on by this node, across its sibling + context links. */
  fanIn: number;
  fanOut: number;
  /** 0..1, degree relative to the busiest sibling. */
  centrality: number;
  /** Max baseline risk score (0..100) of any source range inside. */
  risk: number;
  riskReasons: string[];
  isolated: boolean;
  /** Nothing outside this node references it, and it isn't an entry point / support file. A candidate, not a verdict. */
  unusedCandidate: boolean;
  entrypoints: number;
}

/** Aggregated dependency between two semantic nodes (Imports + Calls rolled up). */
export interface SemanticLink {
  from: string;
  to: string;
  weight: number;
  imports: number;
  calls: number;
  /** Share (0..1) of underlying edges that are name-matched rather than statically confirmed. */
  inferredShare: number;
  /** sibling = both share a parent; context = one end is a top-level domain or external system. */
  scope: "sibling" | "context";
}

export interface EntryPoint {
  id: string;
  label: string;
  method: string;
  path: string;
  filePath: string;
  line: number;
  /** Line where the next route in the same file starts (bounds an inline handler). */
  endLine: number;
  /** Enclosing named function, if the handler isn't inline. */
  functionNodeId: string | null;
  fileNodeId: string;
  semanticId: string | null;
}

export interface SemanticNode {
  id: string;
  type: SemanticType;
  name: string;
  rawName: string;
  /** What this node represents at its level (AI-chosen label, e.g. "Capability",
   *  "Domain", "Service", "Feature"). Deterministic default otherwise. */
  kind: string;
  summary: string;
  capability: string | null;
  /** Technical role (Unit level only): Route, API Client, Service, Data, UI,
   *  Test, Config, Utility, Core. Orthogonal to capability. */
  role: string | null;
  confidence: number;
  source: "deterministic" | "ai-enriched";
  parentId: string | null;
  physicalNodeId: string | null;
  filePath: string | null;
  startLine: number | null;
  endLine: number | null;
  language: string | null;
  childCount: number;
  evidence: Array<{ file: string; startLine: number | null; endLine: number | null }>;
  /** AI-chosen architectural archetype for a Concept (optional; dominant file role is the fallback). */
  architecturalKind?: Archetype | null;
  // Filled by graph/architecture.ts:
  archetype?: Archetype;
  /** Archetype that decides the vertical layer (a Domain sits at its dominant role's layer). */
  layerArchetype?: Archetype;
  /** Vertical architecture layer: 0 Interface … 5 External; -1 = support ring, null = centre (System). */
  layer?: number | null;
  metrics?: NodeMetrics;
}

export interface SemanticTree {
  nodes: SemanticNode[];
  aiEnriched: boolean;
  generatedAt: string;
  links?: SemanticLink[];
  entrypoints?: EntryPoint[];
  /** Bumped when the architecture pass changes shape, so stale stored trees get recomputed. */
  architectureVersion?: number;
}

interface UnitSeed {
  fileNode: GraphNode;
  functions: GraphNode[];
}

/** Collects files with their function/method leaves (methods prefixed by class). */
function collectUnits(nodes: GraphNode[]): UnitSeed[] {
  const files = nodes.filter((n) => n.type === "File" && n.filePath && n.language);
  const symbolsByFile = new Map<string, GraphNode[]>();
  for (const n of nodes) {
    if ((n.type === "Function" || n.type === "Class" || n.type === "Interface") && n.filePath) {
      const list = symbolsByFile.get(n.filePath) ?? [];
      list.push(n);
      symbolsByFile.set(n.filePath, list);
    }
  }
  return files.map((fileNode) => {
    const symbols = (symbolsByFile.get(fileNode.filePath!) ?? []).slice().sort((a, b) => (a.startLine ?? 0) - (b.startLine ?? 0));
    const classRanges = symbols.filter((s) => s.type === "Class" || s.type === "Interface");
    const functions = symbols
      .filter((s) => s.type === "Function")
      .map((sym) => {
        const owner = classRanges.find(
          (c) => c.startLine !== null && c.endLine !== null && sym.startLine !== null && c.startLine <= sym.startLine && (c.endLine ?? 0) >= (sym.endLine ?? 0)
        );
        return { sym, owner };
      })
      .map(({ sym, owner }) => ({ ...sym, name: owner ? `${owner.name}.${sym.name}` : sym.name })) as GraphNode[];
    return { fileNode, functions };
  });
}

/** Deterministic technical-role classification for a file, from its path + name. */
export function classifyRole(filePath: string): string {
  const p = filePath.toLowerCase();
  const base = p.split("/").pop() ?? p;
  if (/(^|\/)(routes?|routing)(\/|$)|route\.|router\.|routes\.|(^|\/)api(\/|$)|endpoint/.test(p)) return "Route";
  if (/client\.|(^|\/)clients?(\/|$)|apiclient|http-?client|sdk/.test(p)) return "API Client";
  if (/(^|\/)controllers?(\/|$)|controller\./.test(p)) return "Controller";
  if (/(^|\/)services?(\/|$)|service\./.test(p)) return "Service";
  if (/(^|\/)(repositor(y|ies)|models?|entities|schema|migrations?)(\/|$)|repository\.|model\.|entity\./.test(p)) return "Data";
  if (/(^|\/)(components?|pages?|views?|screens?|widgets?)(\/|$)|\.(tsx|jsx|vue|svelte)$/.test(p)) return "UI";
  if (/\.(test|spec)\.|(^|\/)tests?(\/|$)|__tests__|_test\./.test(p)) return "Test";
  if (/config|settings|\.env|(^|\/)conf(\/|$)/.test(base)) return "Config";
  if (/(^|\/)(hooks?|utils?|lib|helpers?|common|shared)(\/|$)/.test(p)) return "Utility";
  return "Core";
}

function makeFunctionNode(parentId: string, sym: GraphNode): SemanticNode {
  return {
    id: nanoid(10),
    type: "Function",
    name: sym.name,
    rawName: sym.name,
    kind: sym.name.includes(".") ? "Method" : "Function",
    summary: "Function — open to read its source and AI explanation.",
    capability: null,
    role: null,
    confidence: 1,
    source: "deterministic",
    parentId,
    physicalNodeId: sym.id,
    filePath: sym.filePath,
    startLine: sym.startLine,
    endLine: sym.endLine,
    language: sym.language,
    childCount: 0,
    evidence: [{ file: sym.filePath!, startLine: sym.startLine, endLine: sym.endLine }],
  };
}

function makeUnitNode(parentId: string, seed: UnitSeed): SemanticNode {
  const name = seed.fileNode.filePath!.split("/").pop() ?? seed.fileNode.filePath!;
  return {
    id: nanoid(10),
    type: "Unit",
    name,
    rawName: name,
    kind: "File",
    summary: `Source file with ${seed.functions.length} functions.`,
    capability: null,
    role: classifyRole(seed.fileNode.filePath!),
    confidence: 1,
    source: "deterministic",
    parentId,
    physicalNodeId: seed.fileNode.id,
    filePath: seed.fileNode.filePath,
    startLine: null,
    endLine: null,
    language: seed.fileNode.language,
    childCount: 0,
    evidence: [{ file: seed.fileNode.filePath!, startLine: null, endLine: null }],
  };
}

/**
 * Deterministic conceptual map: groups files by their top-level directory as a
 * proxy for "capability area". This always works (no API key needed); AI
 * enrichment later regroups/renames these into true capabilities.
 */
export function buildSemanticTree(repoName: string, nodes: GraphNode[]): SemanticTree {
  const units = collectUnits(nodes);
  const out: SemanticNode[] = [];

  const system: SemanticNode = {
    id: "system",
    type: "System",
    name: repoName,
    rawName: repoName,
    kind: "System",
    summary: "Explore this system by capability. Drill into a concept to see the files and functions that implement it.",
    capability: null,
    role: null,
    confidence: 1,
    source: "deterministic",
    parentId: null,
    physicalNodeId: null,
    filePath: null,
    startLine: null,
    endLine: null,
    language: null,
    childCount: 0,
    evidence: [],
  };
  out.push(system);

  const conceptByKey = new Map<string, SemanticNode>();
  function ensureConcept(area: string): SemanticNode {
    let existing = conceptByKey.get(area);
    if (existing) return existing;
    existing = {
      id: nanoid(10),
      type: "Concept",
      name: area,
      rawName: area,
      kind: "Area",
      summary: `Files grouped under "${area}".`,
      capability: null,
      role: null,
      confidence: 1,
      source: "deterministic",
      parentId: system.id,
      physicalNodeId: null,
      filePath: area === "Root" ? null : area,
      startLine: null,
      endLine: null,
      language: null,
      childCount: 0,
      evidence: area === "Root" ? [] : [{ file: area, startLine: null, endLine: null }],
    };
    conceptByKey.set(area, existing);
    out.push(existing);
    return existing;
  }

  // Skip any directory prefix shared by ALL files (e.g. a GitHub zipball wrapper
  // folder left over from an older import), so grouping starts at the first level
  // where files actually diverge — never a single redundant wrapper concept.
  const skip = commonDirPrefixLength(units.map((u) => u.fileNode.filePath!));

  for (const seed of units) {
    const segs = seed.fileNode.filePath!.split("/");
    const area = segs.length > skip + 1 ? segs[skip] : "Root";
    const concept = ensureConcept(area);
    const unit = makeUnitNode(concept.id, seed);
    out.push(unit);
    for (const fn of seed.functions) out.push(makeFunctionNode(unit.id, fn));
  }

  finalizeCounts(out);
  return { nodes: out, aiEnriched: false, generatedAt: new Date().toISOString() };
}

/** Number of leading path segments shared by every file (and that remain a directory for all). */
function commonDirPrefixLength(paths: string[]): number {
  if (paths.length === 0) return 0;
  const split = paths.map((p) => p.split("/"));
  const minDirs = Math.min(...split.map((s) => s.length - 1)); // never consume the filename
  let prefix = 0;
  for (let i = 0; i < minDirs; i++) {
    const seg = split[0][i];
    if (split.every((s) => s[i] === seg)) prefix++;
    else break;
  }
  return prefix;
}

/**
 * Rebuilds the Concept level from AI-provided capability groupings. Each concept
 * lists member file ids (validated against real units); unassigned files fall
 * into a "General" concept so nothing is lost. Units/functions are preserved and
 * re-parented under their new concept.
 */
export function applyConceptGrouping(
  tree: SemanticTree,
  overview: string | null,
  concepts: Array<{ name: string; kind?: string; summary?: string; capability?: string | null; confidence?: number; architecturalKind?: string | null; memberUnitIds: string[] }>
): SemanticTree {
  const system = tree.nodes.find((n) => n.type === "System");
  if (!system) return tree;
  const units = tree.nodes.filter((n) => n.type === "Unit");
  const functions = tree.nodes.filter((n) => n.type === "Function");
  const unitById = new Map(units.map((u) => [u.id, u]));

  if (overview && overview.trim()) system.summary = overview.trim().slice(0, 400);

  const newConcepts: SemanticNode[] = [];
  const assigned = new Set<string>();

  for (const c of concepts) {
    const members = (c.memberUnitIds ?? []).filter((id) => unitById.has(id) && !assigned.has(id));
    if (members.length === 0) continue;
    const concept: SemanticNode = {
      id: nanoid(10),
      type: "Concept",
      name: (c.name ?? "Capability").slice(0, 60),
      rawName: (c.name ?? "Capability").slice(0, 60),
      kind: (c.kind ?? "Capability").slice(0, 30),
      summary: (c.summary ?? "").slice(0, 200),
      capability: c.capability ? String(c.capability).slice(0, 60) : null,
      role: null,
      confidence: typeof c.confidence === "number" ? Math.max(0, Math.min(1, c.confidence)) : 0.7,
      source: "ai-enriched",
      parentId: system.id,
      physicalNodeId: null,
      filePath: null,
      startLine: null,
      endLine: null,
      language: null,
      childCount: 0,
      evidence: [],
      architecturalKind: parseArchitecturalKind(c.architecturalKind),
    };
    newConcepts.push(concept);
    for (const id of members) {
      assigned.add(id);
      unitById.get(id)!.parentId = concept.id;
    }
  }

  // Leftover units → a deterministic "General" concept.
  const leftovers = units.filter((u) => !assigned.has(u.id));
  if (leftovers.length > 0) {
    const general: SemanticNode = {
      id: nanoid(10),
      type: "Concept",
      name: "General",
      rawName: "General",
      kind: "Area",
      summary: "Files not assigned to a specific capability.",
      capability: null,
      role: null,
      confidence: 0.5,
      source: "ai-enriched",
      parentId: system.id,
      physicalNodeId: null,
      filePath: null,
      startLine: null,
      endLine: null,
      language: null,
      childCount: 0,
      evidence: [],
    };
    newConcepts.push(general);
    for (const u of leftovers) u.parentId = general.id;
  }

  const rebuilt: SemanticNode[] = [system, ...newConcepts, ...units, ...functions];
  finalizeCounts(rebuilt);
  return { nodes: rebuilt, aiEnriched: true, generatedAt: new Date().toISOString() };
}

const AI_KINDS: Archetype[] = ["Interface", "Gateway", "Service", "Logic", "Data", "Support"];

/** Accepts only the fixed archetype vocabulary the enrichment prompt offers. */
function parseArchitecturalKind(raw: unknown): Archetype | null {
  if (typeof raw !== "string") return null;
  const hit = AI_KINDS.find((k) => k.toLowerCase() === raw.trim().toLowerCase());
  return hit ?? null;
}

export function finalizeCounts(nodes: SemanticNode[]): void {
  const counts = new Map<string, number>();
  for (const n of nodes) if (n.parentId) counts.set(n.parentId, (counts.get(n.parentId) ?? 0) + 1);
  for (const n of nodes) n.childCount = counts.get(n.id) ?? 0;
}

/** File-to-file adjacency from Imports/Calls edges, keyed by file id (= a Unit's physicalNodeId). */
export function buildFileAdjacency(nodes: GraphNode[], edges: GraphEdge[]): Map<string, Set<string>> {
  const fileOf = new Map<string, string | null>();
  for (const n of nodes) fileOf.set(n.id, n.fileId);
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (a === b) return;
    (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
    (adj.get(b) ?? adj.set(b, new Set()).get(b)!).add(a);
  };
  for (const e of edges) {
    if (e.type !== "Imports" && e.type !== "Calls") continue;
    const fa = fileOf.get(e.fromNodeId);
    const fb = fileOf.get(e.toNodeId);
    if (fa && fb) link(fa, fb);
  }
  return adj;
}

export const DOC_EXT = /\.(md|mdx|markdown|txt|rst|adoc)$/i;
export const CONFIG_EXT = /\.(json|ya?ml|toml|xml|ini|lock|env)$/i;

/**
 * Inserts a Group layer between Concept and Unit so large concepts aren't a flat
 * fan of files. Groups are: Tests, Documentation, Configuration (by role/ext),
 * then one group per folder (files alone in a folder join the group they link
 * to most; a single-folder concept is split by link communities instead).
 * Concepts with few files are left flat.
 */
/**
 * Deterministic label propagation over the file adjacency: each file adopts the
 * most common label among its neighbours until stable. Returns communities
 * named after their most-connected file.
 */
function linkCommunities(files: SemanticNode[], adjacency: Map<string, Set<string>>): Map<string, SemanticNode[]> {
  const idOf = (f: SemanticNode) => f.physicalNodeId ?? f.id;
  const ids = new Set(files.map(idOf));
  const label = new Map(files.map((f) => [idOf(f), idOf(f)]));
  const ordered = [...files].sort((a, b) => (a.filePath ?? "").localeCompare(b.filePath ?? ""));
  for (let round = 0; round < 10; round++) {
    let changed = false;
    for (const f of ordered) {
      const counts = new Map<string, number>();
      for (const nb of adjacency.get(idOf(f)) ?? []) if (ids.has(nb)) counts.set(label.get(nb)!, (counts.get(label.get(nb)!) ?? 0) + 1);
      const best = [...counts.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0];
      if (best && best[0] !== label.get(idOf(f))) { label.set(idOf(f), best[0]); changed = true; }
    }
    if (!changed) break;
  }
  const byLabel = new Map<string, SemanticNode[]>();
  for (const f of files) (byLabel.get(label.get(idOf(f))!) ?? byLabel.set(label.get(idOf(f))!, []).get(label.get(idOf(f))!)!).push(f);
  const out = new Map<string, SemanticNode[]>();
  for (const list of byLabel.values()) {
    const hub = [...list].sort((a, b) => (adjacency.get(idOf(b))?.size ?? 0) - (adjacency.get(idOf(a))?.size ?? 0))[0];
    let name = `${hub.rawName.replace(/\.[^.]+$/, "")} & linked`;
    while (out.has(name)) name += "'";
    out.set(name, list);
  }
  return out;
}

/** Undoes addSubgroups (files return to their concept) so a stored tree can be regrouped without losing AI concepts. */
export function removeSubgroups(tree: SemanticTree): SemanticTree {
  const groupParent = new Map(tree.nodes.filter((n) => n.type === "Group").map((g) => [g.id, g.parentId]));
  const nodes = tree.nodes
    .filter((n) => n.type !== "Group")
    .map((n) => (n.parentId && groupParent.has(n.parentId) ? { ...n, parentId: groupParent.get(n.parentId)! } : n));
  finalizeCounts(nodes);
  return { ...tree, nodes };
}

export function addSubgroups(tree: SemanticTree, adjacency: Map<string, Set<string>>): SemanticTree {
  const nodes = tree.nodes;
  const concepts = nodes.filter((n) => n.type === "Concept");
  const groups: SemanticNode[] = [];

  for (const concept of concepts) {
    const files = nodes.filter((n) => n.type === "Unit" && n.parentId === concept.id);
    if (files.length <= 6) continue; // keep small concepts flat

    const makeGroup = (name: string, kind: string): SemanticNode => {
      const g: SemanticNode = {
        id: nanoid(10), type: "Group", name, rawName: name, kind,
        summary: `${name} — ${kind.toLowerCase()} within ${concept.name}.`,
        capability: null, role: null, confidence: 1, source: concept.source,
        parentId: concept.id, physicalNodeId: null, filePath: null,
        startLine: null, endLine: null, language: null, childCount: 0, evidence: [],
      };
      groups.push(g);
      return g;
    };

    const tests: SemanticNode[] = [];
    const docs: SemanticNode[] = [];
    const config: SemanticNode[] = [];
    const core: SemanticNode[] = [];
    for (const f of files) {
      if (f.role === "Test") tests.push(f);
      else if (f.filePath && DOC_EXT.test(f.filePath)) docs.push(f);
      else if (f.role === "Config" || (f.filePath && CONFIG_EXT.test(f.filePath))) config.push(f);
      else core.push(f);
    }

    const attach = (bucket: SemanticNode[], name: string, kind: string) => {
      if (bucket.length >= 2) {
        const g = makeGroup(name, kind);
        for (const f of bucket) f.parentId = g.id;
      }
      // singletons remain directly under the concept
    };
    attach(tests, "Tests", "Tests");
    attach(docs, "Documentation", "Docs");
    attach(config, "Configuration", "Config");

    // Core: one group per folder — folders are how developers already split
    // responsibilities, and unlike "files that import each other" they don't
    // collapse into a single blob once imports resolve.
    const byDir = new Map<string, SemanticNode[]>(); // full folder path → files
    for (const f of core) {
      const d = f.filePath && f.filePath.includes("/") ? f.filePath.slice(0, f.filePath.lastIndexOf("/")) : "";
      (byDir.get(d) ?? byDir.set(d, []).get(d)!).push(f);
    }
    // Name by the folder; add the parent folder when two share a name (two "utils/").
    const leaf = (d: string) => d.split("/").pop() || "Core";
    const leafCount = new Map<string, number>();
    for (const [d, list] of byDir) if (list.length >= 2) leafCount.set(leaf(d), (leafCount.get(leaf(d)) ?? 0) + 1);
    const dirName = (d: string) => ((leafCount.get(leaf(d)) ?? 0) > 1 ? d.split("/").slice(-2).join("/") : leaf(d));
    const groupOfFile = new Map<string, SemanticNode>(); // physical file id → its folder group
    const loners: SemanticNode[] = [];
    const dirGroups = [...byDir.entries()].filter(([, list]) => list.length >= 2);
    if (dirGroups.length === 1 && dirGroups[0][1].length === core.length) {
      // Everything shares one folder: split by link communities instead.
      for (const [label, list] of linkCommunities(core, adjacency)) {
        if (list.length < 2) { loners.push(...list); continue; }
        const g = makeGroup(label, "Linked");
        for (const f of list) { f.parentId = g.id; groupOfFile.set(f.physicalNodeId ?? f.id, g); }
      }
    } else {
      for (const [dir, list] of byDir) {
        if (list.length < 2) { loners.push(...list); continue; }
        const g = makeGroup(dirName(dir), "Module");
        for (const f of list) { f.parentId = g.id; groupOfFile.set(f.physicalNodeId ?? f.id, g); }
      }
    }

    // A file alone in its folder joins the group it talks to most (else stays under the concept).
    for (const f of loners) {
      const votes = new Map<SemanticNode, number>();
      for (const nb of adjacency.get(f.physicalNodeId ?? f.id) ?? []) {
        const g = groupOfFile.get(nb);
        if (g) votes.set(g, (votes.get(g) ?? 0) + 1);
      }
      const best = [...votes.entries()].sort((x, y) => y[1] - x[1] || x[0].name.localeCompare(y[0].name))[0];
      if (best) f.parentId = best[0].id;
    }
  }

  const rebuilt = [...nodes, ...groups];
  finalizeCounts(rebuilt);
  return { ...tree, nodes: rebuilt };
}
