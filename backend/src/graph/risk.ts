import type { GraphEdge, GraphNode } from "./types.js";

export interface RiskScore {
  score: number;
  reasons: string[];
}

/**
 * Deterministic baseline risk per source-ranged node: heavily depended-on,
 * heavily depending, or long. Linear in nodes + edges.
 */
export function computeRisks(nodes: GraphNode[], edges: GraphEdge[]): Map<string, RiskScore> {
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  for (const e of edges) {
    if (e.type !== "Calls" && e.type !== "Imports") continue;
    incoming.set(e.toNodeId, (incoming.get(e.toNodeId) ?? 0) + 1);
    outgoing.set(e.fromNodeId, (outgoing.get(e.fromNodeId) ?? 0) + 1);
  }
  const out = new Map<string, RiskScore>();
  for (const node of nodes) {
    if (!node.filePath || node.startLine === null || node.endLine === null) continue;
    const inc = incoming.get(node.id) ?? 0;
    const outc = outgoing.get(node.id) ?? 0;
    const lines = node.endLine - node.startLine + 1;
    const score = Math.min(100, inc * 8 + outc * 4 + Math.max(0, lines - 40));
    const reasons = [
      inc > 2 ? `${inc} incoming dependencies` : null,
      outc > 4 ? `${outc} outgoing dependencies` : null,
      lines > 80 ? `${lines} source lines` : null,
    ].filter((r): r is string => Boolean(r));
    out.set(node.id, { score, reasons });
  }
  return out;
}
