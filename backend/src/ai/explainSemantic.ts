import type { SemanticNode, SemanticTree } from "../graph/semantic.js";
import { availableProviders, generate } from "./provider.js";

export interface RelatedRef {
  id: string;
  name: string;
  archetype: string | null;
  weight: number;
}

export interface WhyResult {
  purpose: string;
  notes: string[];
  usedBy: RelatedRef[];
  dependsOn: RelatedRef[];
  /** Data stores and external systems this node's dependencies reach — what it changes/touches. */
  affects: RelatedRef[];
  aiUsed: boolean;
  evidence: string[];
}

/**
 * "Why does this exist?" for a map node (Domain/Group/File). The relationship
 * lists are deterministic, read straight off the aggregated links; the model
 * only writes the purpose sentence and notes, grounded in those lists and the
 * member file/function names. Works without an AI key (purpose = stored summary).
 */
export async function explainSemanticNode(tree: SemanticTree, nodeId: string): Promise<WhyResult> {
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));
  const node = byId.get(nodeId);
  if (!node) throw new Error("Node not found");
  const links = tree.links ?? [];

  const ref = (id: string, weight: number): RelatedRef | null => {
    const n = byId.get(id);
    return n ? { id, name: n.name, archetype: n.archetype ?? null, weight } : null;
  };
  const merge = (list: Array<RelatedRef | null>) => {
    const out = new Map<string, RelatedRef>();
    for (const r of list) if (r) out.set(r.id, { ...r, weight: (out.get(r.id)?.weight ?? 0) + r.weight });
    return [...out.values()].sort((a, b) => b.weight - a.weight);
  };
  const usedBy = merge(links.filter((l) => l.to === nodeId).map((l) => ref(l.from, l.weight)));
  const dependsOn = merge(links.filter((l) => l.from === nodeId).map((l) => ref(l.to, l.weight)));
  const affects = dependsOn.filter((r) => r.archetype === "Data" || r.archetype === "External" || byId.get(r.id)?.layerArchetype === "Data");

  // Member files + functions (evidence the model sees).
  const childrenOf = new Map<string, SemanticNode[]>();
  for (const n of tree.nodes) if (n.parentId) (childrenOf.get(n.parentId) ?? childrenOf.set(n.parentId, []).get(n.parentId)!).push(n);
  const members: SemanticNode[] = [];
  const stack = [node];
  while (stack.length && members.length < 400) {
    const cur = stack.pop()!;
    members.push(cur);
    stack.push(...(childrenOf.get(cur.id) ?? []));
  }
  const files = members.filter((m) => m.type === "Unit" && m.filePath).map((m) => m.filePath!).slice(0, 40);
  const functions = members.filter((m) => m.type === "Function").map((m) => m.name).slice(0, 60);

  const base: WhyResult = { purpose: node.summary, notes: [], usedBy: usedBy.slice(0, 12), dependsOn: dependsOn.slice(0, 12), affects: affects.slice(0, 8), aiUsed: false, evidence: files };
  if (availableProviders().length === 0) return base;

  const prompt = `You are explaining one part of a software system to a developer seeing it for the first time.
Answer "why does this exist?" using ONLY the facts below. Infer intent from names, but never invent callers, data or behavior.

Part: "${node.name}" (${node.archetype ?? node.type}${node.kind ? `, ${node.kind}` : ""})
Current summary: ${node.summary || "(none)"}
Files: ${JSON.stringify(files)}
Functions: ${JSON.stringify(functions)}
Used by: ${JSON.stringify(usedBy.slice(0, 12).map((r) => r.name))}
Depends on: ${JSON.stringify(dependsOn.slice(0, 12).map((r) => r.name))}
Touches data/external systems: ${JSON.stringify(affects.map((r) => r.name))}

Return JSON only: {"purpose":"...","notes":["..."]}
- purpose: 1-2 sentences on WHY this part exists and the job it does for the rest of the system. Not a list of its files.
- notes: 0-3 short, specific observations (e.g. it is the only path to the database; it mixes UI and data access). Empty array if nothing stands out.`;

  try {
    const { text } = await generate({ prompt, json: true, maxTokens: 400, temperature: 0.2 });
    const parsed = JSON.parse(text || "{}") as Partial<{ purpose: string; notes: string[] }>;
    return {
      ...base,
      purpose: parsed.purpose?.trim() || base.purpose,
      notes: Array.isArray(parsed.notes) ? parsed.notes.filter((n): n is string => typeof n === "string" && n.trim().length > 0).slice(0, 3) : [],
      aiUsed: true,
    };
  } catch {
    return base; // relationships are still useful without the prose
  }
}
