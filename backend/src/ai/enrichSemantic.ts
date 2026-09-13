import { applyConceptGrouping, type SemanticTree } from "../graph/semantic.js";
import { generate } from "./provider.js";

/**
 * Turns the deterministic file grouping into a CONCEPTUAL map, in two passes so
 * it scales to large repos (a single giant prompt overwhelms fast models):
 *   Pass A — propose capability concepts from a compact directory overview.
 *   Pass B — classify files into those concepts in small batches.
 * Everything references real files, validated before use, so concepts stay
 * evidence-backed. Falls back to the deterministic tree if the model output is
 * unusable.
 */
export async function enrichSemanticTree(repoName: string, tree: SemanticTree): Promise<SemanticTree> {
  const units = tree.nodes.filter((n) => n.type === "Unit");
  if (units.length === 0) return tree;

  // ---- Pass A: propose concepts from a directory summary (small in/out) ----
  const dirAgg = new Map<string, number>();
  for (const u of units) {
    const dir = (u.filePath ?? "").split("/").slice(0, -1).join("/") || "(root)";
    dirAgg.set(dir, (dirAgg.get(dir) ?? 0) + 1);
  }
  const dirSummary = [...dirAgg.entries()].sort((a, b) => b[1] - a[1]).map(([dir, n]) => `${dir} (${n} files)`);
  const samplePaths = units.slice(0, 60).map((u) => u.filePath);

  const promptA = `You are analysing the repository "${repoName}" to explain it conceptually.
Here are its directories (with file counts) and some example file paths.

Directories:
${dirSummary.join("\n")}

Example files:
${samplePaths.join("\n")}

Propose 4-8 high-level CONCEPTS (capabilities / domains / responsibility areas) that best describe THIS codebase — you choose the vocabulary (e.g. "Authentication", "Financial Tracking", "AI Orchestration", "Data Layer", "Mobile UI"). Also write a 2-3 sentence plain-language overview of what the system does.

Return the overview and a list of concepts.`;

  const conceptItemSchema = {
    type: "OBJECT",
    properties: {
      name: { type: "STRING" },
      kind: { type: "STRING" },
      summary: { type: "STRING" },
      capability: { type: "STRING" },
    },
    required: ["name"],
  };
  const passASchema = {
    type: "OBJECT",
    properties: {
      overview: { type: "STRING" },
      concepts: { type: "ARRAY", items: conceptItemSchema },
    },
    required: ["overview", "concepts"],
  };

  let overview: string | null = null;
  let conceptDefs: Array<{ name: string; kind?: string; summary?: string; capability?: string | null }> = [];
  try {
    const { text, provider, model } = await generateWithRetry({ prompt: promptA, json: true, schema: passASchema, schemaName: "concept_proposal", maxTokens: 1500, temperature: 0.2 });
    const parsed = parseJsonLoose(text) as any;
    overview = typeof parsed?.overview === "string" ? parsed.overview : null;
    conceptDefs = Array.isArray(parsed?.concepts)
      ? parsed.concepts.filter((c: any) => c && typeof c.name === "string").map((c: any) => ({ name: c.name, kind: c.kind, summary: c.summary, capability: c.capability ?? null }))
      : [];
    console.log(`[enrich:A] ${provider}/${model}: ${conceptDefs.length} concepts proposed`);
    if (conceptDefs.length === 0) console.error(`[enrich:A] raw output head:`, (text || "").slice(0, 300));
  } catch (err) {
    console.warn(`[enrich:A] failed: ${err instanceof Error ? err.message : err}`);
    throw err; // let the route report the provider error
  }
  if (conceptDefs.length === 0) {
    // Surface this (rather than silently falling back) so the UI can say why.
    throw new Error("AI provider returned no concepts (likely rate-limited or quota-exceeded). Try again shortly or switch model.");
  }

  // Concept set that GROWS across rounds — later batches can reuse or extend it.
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const conceptByNorm = new Map<string, { name: string; kind?: string; summary?: string; capability?: string | null }>();
  for (const c of conceptDefs) conceptByNorm.set(norm(c.name), c);
  function resolveOrAdd(name: unknown, meta?: { kind?: string; summary?: string; capability?: string | null }): string | null {
    if (typeof name !== "string" || !name.trim()) return null;
    const key = norm(name);
    const existing = conceptByNorm.get(key);
    if (existing) return existing.name;
    // tolerant contains-match against existing concepts before creating a new one
    for (const [k, v] of conceptByNorm) if (k.includes(key) || key.includes(k)) return v.name;
    const def = { name: name.trim().slice(0, 40), kind: meta?.kind, summary: meta?.summary, capability: meta?.capability ?? null };
    conceptByNorm.set(key, def);
    return def.name;
  }

  // ---- Pass B: classify files into concepts over many small rounds ----
  const passBSchema = {
    type: "OBJECT",
    properties: {
      assignments: {
        type: "ARRAY",
        items: { type: "OBJECT", properties: { id: { type: "STRING" }, concept: { type: "STRING" } }, required: ["id", "concept"] },
      },
      newConcepts: {
        type: "ARRAY",
        items: { type: "OBJECT", properties: { name: { type: "STRING" }, kind: { type: "STRING" }, summary: { type: "STRING" }, capability: { type: "STRING" } }, required: ["name"] },
      },
    },
    required: ["assignments"],
  };
  const assignments = new Map<string, string>(); // unitId -> canonical concept name
  const BATCH = 18;
  let loggedSample = false;
  for (let i = 0; i < units.length; i += BATCH) {
    const batch = units.slice(i, i + BATCH);
    const idByRef = new Map<string, string>();
    for (const u of batch) {
      idByRef.set(u.id, u.id);
      if (u.filePath) {
        idByRef.set(u.filePath, u.id);
        const base = u.filePath.split("/").pop();
        if (base) idByRef.set(base, u.id);
      }
    }
    const currentNames = [...conceptByNorm.values()].map((c) => c.name);
    const list = batch.map((u) => ({ id: u.id, path: u.filePath }));
    const promptB = `Repository "${repoName}". Concepts so far (prefer these EXACT names): ${JSON.stringify(currentNames)}.
Assign each file below to the single best-fitting concept. If a file genuinely fits none, invent a new short concept name (also list it in newConcepts).
Files:
${JSON.stringify(list)}
Return an "assignments" array with one entry {id, concept} for EVERY file id above, and optionally "newConcepts".`;
    try {
      const { text } = await generateWithRetry({ prompt: promptB, json: true, schema: passBSchema, schemaName: "file_assignments", maxTokens: 3000, temperature: 0 });
      const parsed = parseJsonLoose(text) as any;
      // Register any newly proposed concepts first so assignments can resolve to them.
      for (const nc of Array.isArray(parsed?.newConcepts) ? parsed.newConcepts : []) {
        if (nc && typeof nc.name === "string") resolveOrAdd(nc.name, { kind: nc.kind, summary: nc.summary, capability: nc.capability ?? null });
      }
      const rows: Array<{ id?: unknown; concept?: unknown }> = Array.isArray(parsed?.assignments) ? parsed.assignments : [];
      if (!loggedSample) {
        console.log(`[enrich:B] first-round rows: ${rows.length}, sample:`, JSON.stringify(rows[0] ?? null));
        loggedSample = true;
      }
      for (const row of rows) {
        const ref = typeof row.id === "string" ? row.id : "";
        const unitId = idByRef.get(ref) ?? idByRef.get(ref.split("/").pop() ?? ref);
        const concept = resolveOrAdd(row.concept);
        if (unitId && concept) assignments.set(unitId, concept);
      }
    } catch (err) {
      console.warn(`[enrich:B] batch ${Math.floor(i / BATCH)} failed: ${err instanceof Error ? err.message : err}`);
    }
    await sleep(900); // throttle to stay under provider per-minute rate limits
  }

  const concepts = [...conceptByNorm.values()]
    .map((def) => ({
      name: def.name,
      kind: def.kind,
      summary: def.summary,
      capability: def.capability ?? null,
      confidence: 0.75,
      memberUnitIds: units.filter((u) => assignments.get(u.id) === def.name).map((u) => u.id),
    }))
    .filter((c) => c.memberUnitIds.length > 0);

  const assigned = concepts.reduce((n, c) => n + c.memberUnitIds.length, 0);
  console.log(`[enrich:B] ${concepts.length} concepts, ${assigned}/${units.length} files assigned`);

  if (concepts.length === 0) return tree;
  return applyConceptGrouping(tree, overview, concepts);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retries once on transient provider errors (429 rate limit, 503 overloaded). */
async function generateWithRetry(opts: Parameters<typeof generate>[0]): ReturnType<typeof generate> {
  try {
    return await generate(opts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/429|503|rate|overload|UNAVAILABLE/i.test(msg)) {
      await sleep(2500);
      return generate(opts);
    }
    throw err;
  }
}

/** Parses JSON that may be wrapped in code fences or surrounded by prose. */
function parseJsonLoose(text: string): unknown | null {
  if (!text) return null;
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}
