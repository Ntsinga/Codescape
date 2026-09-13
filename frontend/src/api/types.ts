export type NodeType =
  | "Repository"
  | "Folder"
  | "File"
  | "Class"
  | "Interface"
  | "Function"
  | "ImportedModule";

export type EdgeType = "Contains" | "Imports" | "Calls";
export type Confidence = "statically-confirmed" | "framework-derived";

export interface EvidenceRef {
  file: string;
  startLine: number;
  endLine: number;
}

export interface GraphNode {
  id: string;
  repoId: string;
  type: NodeType;
  name: string;
  parentId: string | null;
  fileId: string | null;
  filePath: string | null;
  startLine: number | null;
  endLine: number | null;
  language: string | null;
  metadata: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  repoId: string;
  fromNodeId: string;
  toNodeId: string;
  type: EdgeType;
  confidence: Confidence;
  evidence: EvidenceRef[];
}

export interface RepoSummary {
  id: string;
  name: string;
  createdAt: string;
  status: "processing" | "ready" | "failed";
  error: string | null;
}

export interface ExplainResult {
  explanation: string;
  evidence: EvidenceRef[];
}

export interface ImpactResult {
  node: GraphNode;
  impacted: Array<{ node: GraphNode; depth: number; via: EdgeType[] }>;
}

export interface ArchitectureFinding { title: string; summary: string; confidence: number; evidence: EvidenceRef[]; }
export interface ArchitectureResult { summary: string; findings: ArchitectureFinding[]; }

export type SemanticType = "System" | "Concept" | "Unit" | "Function";

export interface SemanticNode {
  id: string;
  type: SemanticType;
  name: string;
  rawName: string;
  kind: string;
  summary: string;
  capability: string | null;
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
  enrichmentError?: string;
}

export interface StackResult {
  languages: Array<{ name: string; files: number }>;
  frameworks: Array<{ name: string; source: string }>;
}

export interface DiagramResult { diagrams: Array<{ type: string; title: string; nodes: GraphNode[]; edges: GraphEdge[] }>; evidencePolicy: string; }
export interface RiskResult { risks: Array<{ node: GraphNode; score: number; reasons: string[] }>; policy: string; }
export interface GitHubRepo { id: number; name: string; fullName: string; private: boolean; defaultBranch: string; cloneUrl: string; }
