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
  explanation: string;
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
Only describe what is actually shown below. Do not invent behavior, callers, or side effects that are not visible in the code.

${req.nodeType} "${req.nodeName}" in ${req.filePath} (lines ${req.startLine}-${req.endLine}):
\`\`\`
${req.code}
\`\`\`
${contextBlocks ? `\nRelated imported code for context:\n${contextBlocks}` : ""}

Write a concise 2-4 sentence explanation of what this ${req.nodeType.toLowerCase()} does, in plain language.`;

  const { text } = await generate({ prompt, maxTokens: 300, temperature: 0.2 });
  const explanation = text.trim() || "No explanation returned.";
  return { explanation, evidence };
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
