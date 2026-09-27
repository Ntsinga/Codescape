import type { EvidenceRef } from "../graph/types.js";
import { generate } from "./provider.js";

export interface ExplainRequest {
  nodeName: string;
  nodeType: string;
  code: string;
  filePath: string;
  startLine: number;
  endLine: number;
  importSnippets: { filePath: string; startLine: number; endLine: number; code: string }[];
}

export interface ExplainResult {
  /** One sentence on why this exists / its role in the system, not just a rephrasing of its name. */
  purpose: string;
  /** What it actually does and how, in plain language. */
  behavior: string;
  /** Non-obvious choices, risks, or edge cases worth flagging at a glance. Empty if nothing stands out. */
  notes: string[];
  evidence: EvidenceRef[];
}

export interface ArchitectureFinding { title: string; summary: string; confidence: number; evidence: EvidenceRef[]; }
export interface ArchitectureResult { summary: string; findings: ArchitectureFinding[]; }

/**
 * Explains a single graph node (class/function) using only the source text
 * already extracted deterministically. Returns the explanation plus the exact
 * evidence (file/line ranges) that were sent to the model, so the UI can keep
 * the AI output traceable to source rather than presented as bare fact.
 */
export async function explainNode(req: ExplainRequest): Promise<ExplainResult> {
  const evidence: EvidenceRef[] = [
    { file: req.filePath, startLine: req.startLine, endLine: req.endLine },
    ...req.importSnippets.map((s) => ({ file: s.filePath, startLine: s.startLine, endLine: s.endLine })),
  ];

  const contextBlocks = req.importSnippets
    .map((s) => `--- ${s.filePath} (lines ${s.startLine}-${s.endLine}) ---\n${s.code}`)
    .join("\n\n");

  const prompt = `You are explaining a piece of source code to a developer who is unfamiliar with this codebase.
Ground everything in the code shown below. You may reasonably infer intent from naming, comments, and
structure, but say so as inference — never invent behavior, callers, or side effects that aren't visible
in the code or the related imports given.

${req.nodeType} "${req.nodeName}" in ${req.filePath} (lines ${req.startLine}-${req.endLine}):
\`\`\`
${req.code}
\`\`\`
${contextBlocks ? `\nRelated imported code for context:\n${contextBlocks}` : ""}

Return JSON only in this shape: {"purpose":"...","behavior":"...","notes":["...","..."]}
- purpose: one sentence on WHY this ${req.nodeType.toLowerCase()} exists and what role it plays in the
  system — not a rephrasing of its name or a restatement of "behavior".
- behavior: 2-4 sentences on WHAT it actually does and how, in plain language.
- notes: 0-3 short, specific points a developer would want to know at a glance — a non-obvious design
  choice, a risk, an edge case, something fragile or worth double-checking. Omit entirely (empty array)
  if nothing stands out; never pad this with generic filler.`;

  const { text } = await generate({ prompt, json: true, maxTokens: 500, temperature: 0.2 });
  let parsed: Partial<{ purpose: string; behavior: string; notes: string[] }> = {};
  try {
    parsed = JSON.parse(text || "{}");
  } catch {
    // Model didn't return valid JSON (rare, but shouldn't break the UI) — surface the raw
    // text as the behavior field rather than losing it.
  }
  return {
    purpose: parsed.purpose?.trim() ?? "",
    behavior: parsed.behavior?.trim() || text.trim() || "No explanation returned.",
    notes: Array.isArray(parsed.notes) ? parsed.notes.filter((n): n is string => typeof n === "string" && n.trim().length > 0) : [],
    evidence,
  };
}

export async function analyzeArchitecture(input: { repoName: string; nodes: unknown[]; edges: unknown[] }): Promise<ArchitectureResult> {
  const compactNodes = input.nodes.slice(0, 220).map((n: any) => ({ id: n.id, type: n.type, name: n.name, filePath: n.filePath, startLine: n.startLine, endLine: n.endLine }));
  const compactEdges = input.edges.slice(0, 320).map((e: any) => ({ fromNodeId: e.fromNodeId, toNodeId: e.toNodeId, type: e.type, confidence: e.confidence }));
  const prompt = `Analyze this codebase graph using only the supplied evidence. Identify likely architectural components and business/domain clusters, but clearly distinguish inference from fact. Return JSON only in this shape: {"summary":"...","findings":[{"title":"...","summary":"...","confidence":0.0,"evidence":[{"file":"...","startLine":1,"endLine":1}]}]}. Confidence must be between 0 and 1. Evidence must reference supplied node filePath and line ranges; do not invent paths or lines. Keep at most 8 findings.\nRepository: ${input.repoName}\nGraph nodes: ${JSON.stringify(compactNodes)}\nGraph edges: ${JSON.stringify(compactEdges)}`;
  const { text } = await generate({ prompt, json: true, maxTokens: 1800, temperature: 0.1 });
  let parsed: Partial<ArchitectureResult> = {};
  try { parsed = JSON.parse(text || "{}"); } catch { /* leave empty */ }
  return { summary: parsed.summary ?? "No architecture summary returned.", findings: Array.isArray(parsed.findings) ? parsed.findings.slice(0, 8) as ArchitectureFinding[] : [] };
}
