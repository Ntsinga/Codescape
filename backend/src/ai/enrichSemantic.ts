import { applyConceptGrouping, type SemanticTree } from "../graph/semantic.js";
import { generate } from "./provider.js";

/**
 * Turns the deterministic file grouping into a CONCEPTUAL map: the AI writes a
 * plain-language overview of what the system does, then groups the real files
 * into capabilities/domains that best describe THIS codebase (its own choice of
 * layer vocabulary). Grouping references real unit ids, which
 * applyConceptGrouping validates — so concepts are always backed by real files.
 */
export async function enrichSemanticTree(repoName: string, tree: SemanticTree): Promise<SemanticTree> {
  const units = tree.nodes.filter((n) => n.type === "Unit");
  const childrenOf = (id: string) => tree.nodes.filter((n) => n.parentId === id);

  // Give the model each real file (id + path + a few function names) to group.
  const unitList = units.slice(0, 400).map((u) => ({
    id: u.id,
    path: u.filePath,
    functions: childrenOf(u.id).slice(0, 6).map((f) => f.rawName),
  }));

  const prompt = `You are helping a developer understand the repository "${repoName}" conceptually first, then technically.

Below is every source file (with id, path, and sample function names). Do two things:
1. Write "overview": 2-3 sentences in plain language describing what this system does and its main capabilities.
2. Group the files into "concepts" — the capabilities / domains / responsibility areas that best describe THIS codebase. You choose the number of concepts and the vocabulary (e.g. "Authentication", "Financial Tracking", "AI Orchestration", "Data Layer"). Every file id should belong to exactly one concept. Order concepts from most central to least.

For each concept return: "name" (2-4 words), "kind" (what kind of layer this is, e.g. "Capability", "Domain", "Service", "Subsystem"), "summary" (one sentence), "capability" (short domain tag or null), "confidence" (0..1), and "memberUnitIds" (array of file ids from the list — only ids that appear below).

Return JSON only:
{"overview":"...","concepts":[{"name","kind","summary","capability","confidence","memberUnitIds":[]}]}

Files:
${JSON.stringify(unitList)}`;

  const { text } = await generate({ prompt, json: true, maxTokens: 3000, temperature: 0.2 });

  let parsed: {
    overview?: string;
    concepts?: Array<{ name?: string; kind?: string; summary?: string; capability?: string | null; confidence?: number; memberUnitIds?: string[] }>;
  };
  try {
    parsed = JSON.parse(text || "{}");
  } catch {
    return tree; // keep deterministic grouping on parse failure
  }

  const concepts = (parsed.concepts ?? [])
    .filter((c) => c && typeof c.name === "string" && Array.isArray(c.memberUnitIds))
    .map((c) => ({
      name: c.name as string,
      kind: c.kind,
      summary: c.summary,
      capability: c.capability ?? null,
      confidence: c.confidence,
      memberUnitIds: (c.memberUnitIds ?? []).filter((id): id is string => typeof id === "string"),
    }));

  if (concepts.length === 0) return tree;
  return applyConceptGrouping(tree, parsed.overview ?? null, concepts);
}
