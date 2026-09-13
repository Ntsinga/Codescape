import { nanoid } from "nanoid";
import type { GraphNode } from "./types.js";

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
export type SemanticType = "System" | "Concept" | "Unit" | "Function";

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
}

export interface SemanticTree {
  nodes: SemanticNode[];
  aiEnriched: boolean;
  generatedAt: string;
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
  concepts: Array<{ name: string; kind?: string; summary?: string; capability?: string | null; confidence?: number; memberUnitIds: string[] }>
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

function finalizeCounts(nodes: SemanticNode[]): void {
  const counts = new Map<string, number>();
  for (const n of nodes) if (n.parentId) counts.set(n.parentId, (counts.get(n.parentId) ?? 0) + 1);
  for (const n of nodes) n.childCount = counts.get(n.id) ?? 0;
}
