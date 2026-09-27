import type { Archetype, SemanticLink } from "../api/types";
import type { ExplorerNode } from "../state/store";

/**
 * The visual grammar of the 3D map. Every visual property answers one
 * question about the system, and each rule lives here so the whole scene
 * speaks the same language:
 *
 *   size          → scope (files + lines)
 *   height        → architecture layer
 *   distance      → relationship (force layout pulled by dependency weight)
 *   shape         → component type (archetype)
 *   transparency  → abstraction level (domains glassy, functions solid)
 *   colour accent → domain (inherited from the top-level concept)
 *   glow          → activity (recent commits when history exists; else hover/flow)
 *   link width    → dependency strength
 *   link motion   → direction of control/data flow
 *   dashed link   → inferred / external
 *   halo          → AI confidence (opacity) and centrality (radius)
 *   pulse         → on the active code path
 *   amber/red     → risk
 *   orbiting dots → internal components
 */

// ---- Palette: near-black, restrained accents (no neon) -------------------------

export const PALETTE = {
  background: "#05070b",
  fog: "#05070b",
  grid: "#0d141d",
  gridSection: "#131c28",
  frame: "#9fb3c8",
  white: "#e6f1ff",
  dim: "#3b4a5e",
  cyan: "#7dd3fc",
  amber: "#f5b041",
  red: "#f87171",
  plane: "#8fb4d9",
};

/** Accent hues handed to top-level domains, in order. Amber is reserved for external systems + risk. */
const DOMAIN_HUES = ["#7dd3fc", "#5eead4", "#a5b4fc", "#f9a8d4", "#bef264", "#93c5fd", "#c4b5fd", "#67e8f9"];

// ---- Layers (height) --------------------------------------------------------------

export const LAYER_GAP = 4.2;

export const LAYERS: Array<{ index: number; label: string; archetype: Archetype }> = [
  { index: 0, label: "FRONTEND", archetype: "Interface" },
  { index: 1, label: "API / GATEWAY", archetype: "Gateway" },
  { index: 2, label: "SERVICES", archetype: "Service" },
  { index: 3, label: "DOMAIN / LOGIC", archetype: "Logic" },
  { index: 4, label: "DATA", archetype: "Data" },
  { index: 5, label: "EXTERNAL SYSTEMS", archetype: "External" },
];

/** World Y for a layer index; the stack is centred on y=0 so the camera frames it evenly. */
export function layerY(layer: number): number {
  return (2.5 - layer) * LAYER_GAP;
}

/** Height of the system's semantic core: between Services and Logic. */
export const CORE_Y = layerY(2.5);

// ---- Shape vocabulary ------------------------------------------------------------

export const ARCHETYPE_LABEL: Record<Archetype, string> = {
  System: "System",
  Domain: "Domain",
  Interface: "Interface",
  Gateway: "API / Gateway",
  Service: "Service",
  Logic: "Logic",
  Data: "Data",
  External: "External",
  Support: "Support",
  Function: "Function",
};

/** Flat glyph shown in the floating label (typography stays 2D). */
export const ARCHETYPE_GLYPH: Record<Archetype, string> = {
  System: "◉",
  Domain: "◇",
  Interface: "▭",
  Gateway: "⊙",
  Service: "✦",
  Logic: "◈",
  Data: "⛁",
  External: "⟁",
  Support: "·",
  Function: "ƒ",
};

export function archetypeOf(node: ExplorerNode): Archetype {
  return node.archetype ?? "Logic";
}

// ---- Size = scope ----------------------------------------------------------------

const BASE_SIZE: Record<Archetype, number> = {
  System: 1.6,
  Domain: 1.15,
  Interface: 0.8,
  Gateway: 0.8,
  Service: 0.8,
  Logic: 0.75,
  Data: 0.8,
  External: 0.8,
  Support: 0.5,
  Function: 0.38,
};

export function sizeOf(node: ExplorerNode): number {
  const a = archetypeOf(node);
  const m = node.metrics;
  if (!m || a === "External" || a === "System") return BASE_SIZE[a];
  const scope = Math.log2(1 + m.files + m.loc / 500);
  const scale = a === "Function" ? 0.85 + Math.min(0.6, m.loc / 120) : 0.7 + Math.min(1.1, scope * 0.22);
  return BASE_SIZE[a] * scale;
}

// ---- Transparency = abstraction level --------------------------------------------

export function shellOpacity(a: Archetype): number {
  switch (a) {
    case "System": return 0.05;
    case "Domain": return 0.09;
    case "Function": return 0.85;
    case "Support": return 0.12;
    default: return 0.18;
  }
}

// ---- Colour = domain -------------------------------------------------------------

/** Maps every node to the accent of its top-level domain (externals amber, system white). */
export function buildAccentMap(nodes: ExplorerNode[], nodesById: Map<string, ExplorerNode>): Map<string, string> {
  const topLevel = nodes
    .filter((n) => n.type === "Concept")
    .sort((a, b) => a.name.localeCompare(b.name));
  const hueOf = new Map<string, string>();
  topLevel.forEach((n, i) => hueOf.set(n.id, DOMAIN_HUES[i % DOMAIN_HUES.length]));

  const out = new Map<string, string>();
  for (const n of nodes) {
    let cur: ExplorerNode | undefined = n;
    let accent = PALETTE.cyan;
    while (cur) {
      if (cur.type === "External") { accent = PALETTE.amber; break; }
      if (cur.type === "System") { accent = PALETTE.white; break; }
      const hue = hueOf.get(cur.id);
      if (hue) { accent = hue; break; }
      cur = cur.parentId ? nodesById.get(cur.parentId) : undefined;
    }
    out.set(n.id, accent);
  }
  return out;
}

// ---- Links -----------------------------------------------------------------------

export function linkWidth(weight: number): number {
  return Math.min(4, 0.7 + Math.log2(1 + weight) * 0.55);
}

export function linkDashed(link: SemanticLink, target: ExplorerNode | undefined): boolean {
  return link.inferredShare > 0.5 || target?.type === "External";
}

export function linkOpacity(weight: number, maxWeight: number): number {
  return 0.22 + 0.5 * (Math.log2(1 + weight) / Math.log2(2 + maxWeight));
}

// ---- Halo = AI confidence + centrality ------------------------------------------

export function haloOf(node: ExplorerNode): { opacity: number; radius: number } | null {
  const ai = node.source === "ai-enriched" && typeof node.confidence === "number";
  const centrality = node.metrics?.centrality ?? 0;
  if (!ai && centrality < 0.6) return null;
  return { opacity: ai ? 0.15 + node.confidence! * 0.35 : 0.2, radius: 1.15 + centrality * 0.5 };
}

// ---- Risk ------------------------------------------------------------------------

export function riskColor(risk: number): string | null {
  if (risk >= 60) return PALETTE.red;
  if (risk >= 30) return PALETTE.amber;
  return null;
}

/** Coupling = distinct neighbours; "high" relative to a fixed budget so it means the same at every level. */
export function couplingOf(node: ExplorerNode): number {
  const m = node.metrics;
  return m ? Math.min(1, (m.fanIn + m.fanOut) / 12) : 0;
}

// ---- Level model -----------------------------------------------------------------

export type Level = 1 | 2 | 3 | 4;

export const LEVEL_META: Record<Level, { name: string; shows: string; next: string }> = {
  1: { name: "System", shows: "Major domains and the external systems they depend on", next: "Explode a domain to see its architecture" },
  2: { name: "Architecture", shows: "Components of this domain spread across the architecture layers", next: "Explode a component to see its implementation" },
  3: { name: "Component", shows: "Functions inside this component and how they call each other", next: "Open a function to read its code" },
  4: { name: "Code", shows: "Source", next: "" },
};

export function levelOf(focus: ExplorerNode | null | undefined): Level {
  if (!focus) return 1;
  switch (focus.type) {
    case "System":
    case "Repository":
      return 1;
    case "Concept":
    case "Group":
    case "Folder":
      return 2;
    default:
      return 3;
  }
}
