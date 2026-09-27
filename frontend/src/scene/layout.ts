import { forceLink, forceManyBody, forceRadial, forceSimulation, forceX, forceY, type SimulationNodeDatum } from "d3-force";
import type { SemanticLink } from "../api/types";
import type { ExplorerNode } from "../state/store";
import { layerY, sizeOf } from "./grammar";

export type Vec3 = [number, number, number];

export interface Placed {
  node: ExplorerNode;
  position: Vec3;
  size: number;
}

export interface SceneLayout {
  mode: "layered" | "radial";
  placed: Placed[];
  /** Nodes outside the focus that the visible ones depend on (other domains, external systems). */
  anchors: Placed[];
  /** Layer indexes that have at least one node (planes are drawn only for these). */
  layers: number[];
  radius: number;
  top: number;
  bottom: number;
}

interface SimNode extends SimulationNodeDatum {
  id: string;
  layer: number;
  r: number;
  isolated: boolean;
}

/** Support files (tests/config/docs) sit on a dim ring at the Logic height, outside the planes. */
const SUPPORT_Y_LAYER = 3;

/** Small deterministic PRNG so the same repo always lays out the same way. */
function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Keeps nodes on the SAME plane apart; nodes on different planes may overlap in plan view. */
function forceLayerCollide(padding: number) {
  let nodes: SimNode[] = [];
  const force = () => {
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        if (a.layer !== b.layer) continue;
        const dx = b.x! - a.x!;
        const dy = b.y! - a.y!;
        const min = a.r + b.r + padding;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 0.01;
        const push = ((min - d) / d) * 0.5;
        a.x! -= dx * push;
        a.y! -= dy * push;
        b.x! += dx * push;
        b.y! += dy * push;
      }
    }
  };
  force.initialize = (n: SimNode[]) => { nodes = n; };
  return force;
}

/**
 * Architecture-layer layout. Height is fixed by layer (frontend on top,
 * external systems at the bottom); position within a plane comes from a short
 * deterministic force run where dependencies pull nodes together — so linked
 * nodes on different planes line up vertically and read as a flow — and
 * isolated nodes drift to the rim.
 */
export function layeredLayout(children: ExplorerNode[], links: SemanticLink[], anchorNodes: ExplorerNode[]): SceneLayout {
  const n = children.length;
  if (n === 0) return { mode: "layered", placed: [], anchors: [], layers: [], radius: 4, top: 0, bottom: 0 };

  const layerOf = (c: ExplorerNode) => (c.layer === undefined || c.layer === null ? 3 : c.layer);
  const ordered = [...children].sort((a, b) => layerOf(a) - layerOf(b) || sizeOf(b) - sizeOf(a) || a.id.localeCompare(b.id));
  const golden = Math.PI * (3 - Math.sqrt(5));
  const spread = Math.max(4, Math.sqrt(n) * 2.2);

  const simNodes: SimNode[] = ordered.map((c, i) => {
    const r = Math.sqrt(i + 0.5) / Math.sqrt(n) * spread;
    return {
      id: c.id,
      layer: layerOf(c),
      r: sizeOf(c) * 1.25 + 0.9, // room for the floating label
      isolated: Boolean(c.metrics?.isolated),
      x: Math.cos(i * golden) * r,
      y: Math.sin(i * golden) * r,
    };
  });
  const ids = new Set(simNodes.map((s) => s.id));
  const simLinks = links
    .filter((l) => l.scope === "sibling" && ids.has(l.from) && ids.has(l.to))
    .map((l) => ({ source: l.from, target: l.to, weight: l.weight }));
  const rimRadius = spread * 1.3 + 3;

  const sim = forceSimulation<SimNode>(simNodes)
    .randomSource(seeded(hash(ordered.map((c) => c.id).join("|"))))
    .force("link", forceLink<SimNode, { source: string; target: string; weight: number }>(simLinks)
      .id((d) => d.id)
      .distance((l) => (l.source as unknown as SimNode).r + (l.target as unknown as SimNode).r + 1.5)
      .strength((l) => Math.min(0.9, 0.08 + Math.log2(1 + l.weight) * 0.07)))
    .force("charge", forceManyBody<SimNode>().strength(-14).distanceMax(28))
    .force("x", forceX<SimNode>(0).strength((d) => (d.isolated ? 0 : 0.045)))
    .force("y", forceY<SimNode>(0).strength((d) => (d.isolated ? 0 : 0.045)))
    .force("rim", forceRadial<SimNode>(rimRadius).strength((d) => (d.isolated ? 0.12 : 0)))
    .force("collide", forceLayerCollide(0.6))
    .stop();
  const ticks = n > 250 ? 140 : 260;
  for (let i = 0; i < ticks; i++) sim.tick();

  // Re-centre the plan view.
  const mx = simNodes.reduce((s, d) => s + d.x!, 0) / n;
  const mz = simNodes.reduce((s, d) => s + d.y!, 0) / n;
  const byId = new Map(ordered.map((c) => [c.id, c]));
  const placed: Placed[] = simNodes.map((d) => {
    const node = byId.get(d.id)!;
    let x = d.x! - mx;
    let z = d.y! - mz;
    if (d.layer === -1) {
      // Support ring: push outward, keep angle.
      const ang = Math.atan2(z, x);
      const rr = Math.max(Math.hypot(x, z), rimRadius) + 2;
      x = Math.cos(ang) * rr;
      z = Math.sin(ang) * rr;
    }
    return { node, position: [x, layerY(d.layer === -1 ? SUPPORT_Y_LAYER : d.layer), z], size: sizeOf(node) };
  });

  const radius = Math.max(4, ...placed.map((p) => Math.hypot(p.position[0], p.position[2]) + p.size));
  const anchors = placeAnchors(anchorNodes, placed, links, radius + 5);
  const layers = [...new Set(placed.map((p) => layerOf(p.node)).filter((l) => l >= 0).concat(anchors.map((a) => layerOf(a.node))))].sort((a, b) => a - b);
  const ys = [...placed, ...anchors].map((p) => p.position[1]);
  return { mode: "layered", placed, anchors, layers, radius, top: Math.max(...ys), bottom: Math.min(...ys) };
}

/** Puts each context anchor on its own layer, at the rim, facing the nodes that link to it. */
function placeAnchors(anchorNodes: ExplorerNode[], placed: Placed[], links: SemanticLink[], ringRadius: number): Placed[] {
  if (anchorNodes.length === 0) return [];
  const pos = new Map(placed.map((p) => [p.node.id, p.position]));
  const withAngle = anchorNodes.map((a) => {
    let sx = 0;
    let sz = 0;
    for (const l of links) {
      const other = l.to === a.id ? l.from : l.from === a.id ? l.to : null;
      const p = other ? pos.get(other) : undefined;
      if (p) { sx += p[0] * l.weight; sz += p[2] * l.weight; }
    }
    const angle = sx === 0 && sz === 0 ? (hash(a.id) % 628) / 100 : Math.atan2(sz, sx);
    return { a, angle };
  });
  // Enforce a minimum angular gap so anchors on the same plane don't stack.
  withAngle.sort((p, q) => p.angle - q.angle);
  const minGap = Math.min(0.6, (Math.PI * 2) / withAngle.length);
  for (let i = 1; i < withAngle.length; i++) {
    if (withAngle[i].angle - withAngle[i - 1].angle < minGap) withAngle[i].angle = withAngle[i - 1].angle + minGap;
  }
  return withAngle.map(({ a, angle }) => ({
    node: a,
    position: [Math.cos(angle) * ringRadius, layerY(a.layer === undefined || a.layer === null || a.layer < 0 ? 3 : a.layer), Math.sin(angle) * ringRadius],
    size: sizeOf(a) * 0.75,
  }));
}

/**
 * Fibonacci-canopy layout for the physical Files layer (folders/files have no
 * architecture layer). Kept from the original scene.
 */
export function radialLayout(children: ExplorerNode[]): SceneLayout {
  const n = children.length;
  if (n === 0) return { mode: "radial", placed: [], anchors: [], layers: [], radius: 4, top: 0, bottom: 0 };
  const spacing = 4.2;
  const radius = n === 1 ? 6 : Math.max(6, (spacing * Math.sqrt(n)) / 2.4);
  const golden = Math.PI * (3 - Math.sqrt(5));
  const placed: Placed[] = children.map((node, i) => {
    if (n === 1) return { node, position: [0, 0, 6] as Vec3, size: 0.8 };
    const y = 1 - (i / (n - 1)) * 2;
    const rAtY = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    return { node, position: [Math.cos(theta) * rAtY * radius, y * radius * 0.55, Math.sin(theta) * rAtY * radius] as Vec3, size: 0.8 };
  });
  const ys = placed.map((p) => p.position[1]);
  return { mode: "radial", placed, anchors: [], layers: [], radius, top: Math.max(...ys), bottom: Math.min(...ys) };
}
