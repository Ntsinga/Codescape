import type { FlowResult, HistoryResult } from "../api/types";
import type { ExplorerNode } from "../state/store";

// ---- Flow → what's visible ---------------------------------------------------

export interface VisibleFlow {
  /** Visible node ids in the order the flow reaches them. */
  order: string[];
  /** Links on the path, keyed "from>to" between visible nodes. */
  keys: Set<string>;
}

/**
 * A flow is traced at code level (functions), but the user may be looking at
 * domains. Each step carries its semantic ancestor chain, so it maps to the
 * first ancestor that's on screen — and hops inside one visible node vanish.
 */
export function visibleFlow(flow: FlowResult | null, visible: Set<string>, chainOf: (id: string) => string[]): VisibleFlow {
  const empty = { order: [], keys: new Set<string>() };
  if (!flow) return empty;
  const pick = (chain: string[]) => chain.find((id) => visible.has(id)) ?? null;
  const visOf = new Map<string, string | null>();
  for (const s of flow.steps) visOf.set(s.nodeId, pick(s.semanticChain));

  const start = flow.entrypoint.semanticId ? pick(chainOf(flow.entrypoint.semanticId)) : null;
  const order: string[] = [];
  const keys = new Set<string>();
  if (start) order.push(start);
  for (const s of flow.steps) {
    const v = visOf.get(s.nodeId);
    if (!v) continue;
    const from = s.parentNodeId ? visOf.get(s.parentNodeId) ?? start : start;
    if (from && from !== v) keys.add(`${from}>${v}`);
    if (!order.includes(v)) order.push(v);
  }
  return { order, keys };
}

// ---- Git history → per semantic node -----------------------------------------

export interface NodeHistory {
  firstSeen: number;
  commits: number;
  monthly: Map<string, number>;
}

/** Rolls per-file history up the semantic tree (a domain appeared when its first file did). */
export function semanticHistory(nodes: ExplorerNode[], history: HistoryResult | null): Map<string, NodeHistory> {
  const out = new Map<string, NodeHistory>();
  if (!history?.available) return out;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    if (n.type !== "Unit" || !n.filePath) continue;
    const h = history.files[n.filePath];
    if (!h) continue;
    const first = Date.parse(h.firstSeen);
    let cur: ExplorerNode | undefined = n;
    while (cur) {
      let agg = out.get(cur.id);
      if (!agg) {
        agg = { firstSeen: first, commits: 0, monthly: new Map() };
        out.set(cur.id, agg);
      }
      agg.firstSeen = Math.min(agg.firstSeen, first);
      agg.commits += h.commits;
      for (const [m, c] of Object.entries(h.monthly)) agg.monthly.set(m, (agg.monthly.get(m) ?? 0) + c);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
  }
  // Functions inherit their file's history.
  for (const n of nodes) {
    if (n.type === "Function" && n.parentId && out.has(n.parentId)) out.set(n.id, out.get(n.parentId)!);
  }
  return out;
}

const ACTIVITY_WINDOW_MONTHS = 3;

function monthKey(t: number): string {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Commits in the few months up to `t` (the "activity" glow). */
export function commitsNear(h: NodeHistory, t: number): number {
  let sum = 0;
  const d = new Date(t);
  for (let i = 0; i < ACTIVITY_WINDOW_MONTHS; i++) {
    const k = monthKey(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    sum += h.monthly.get(k) ?? 0;
  }
  return sum;
}

export function formatMonth(t: number): string {
  return new Date(t).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}
