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
  origin?: { kind: "zip" | "github" | null; owner: string | null; repo: string | null; branch: string | null };
}

export interface ExplainResult {
  purpose: string;
  behavior: string;
  notes: string[];
  evidence: EvidenceRef[];
}

export interface ImpactResult {
  node: GraphNode;
  impacted: Array<{ node: GraphNode; depth: number; via: EdgeType[] }>;
}

export interface ArchitectureFinding { title: string; summary: string; confidence: number; evidence: EvidenceRef[]; }
export interface ArchitectureResult { summary: string; findings: ArchitectureFinding[]; }

export type SemanticType = "System" | "Concept" | "Group" | "Unit" | "Function" | "External";

/** What a node IS architecturally — drives its 3D form. Mirrors backend graph/semantic.ts. */
export type Archetype =
  | "System"
  | "Domain"
  | "Interface"
  | "Gateway"
  | "Service"
  | "Logic"
  | "Data"
  | "External"
  | "Support"
  | "Function";

export interface NodeMetrics {
  files: number;
  functions: number;
  loc: number;
  fanIn: number;
  fanOut: number;
  centrality: number;
  risk: number;
  riskReasons: string[];
  isolated: boolean;
  unusedCandidate: boolean;
  entrypoints: number;
}

export interface SemanticLink {
  from: string;
  to: string;
  weight: number;
  imports: number;
  calls: number;
  inferredShare: number;
  scope: "sibling" | "context";
}

export interface EntryPoint {
  id: string;
  label: string;
  method: string;
  path: string;
  filePath: string;
  line: number;
  endLine: number;
  functionNodeId: string | null;
  fileNodeId: string;
  semanticId: string | null;
}

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
  architecturalKind?: Archetype | null;
  archetype?: Archetype;
  layerArchetype?: Archetype;
  layer?: number | null;
  metrics?: NodeMetrics;
}

export interface SemanticTree {
  nodes: SemanticNode[];
  aiEnriched: boolean;
  generatedAt: string;
  enrichmentError?: string;
  links?: SemanticLink[];
  entrypoints?: EntryPoint[];
  architectureVersion?: number;
}

export interface StackResult {
  languages: Array<{ name: string; files: number }>;
  frameworks: Array<{ name: string; source: string }>;
}

export interface DiagramResult { diagrams: Array<{ type: string; title: string; nodes: GraphNode[]; edges: GraphEdge[] }>; evidencePolicy: string; }
export interface RiskResult { risks: Array<{ node: GraphNode; score: number; reasons: string[] }>; policy: string; }
export interface GitHubRepo { id: number; name: string; fullName: string; private: boolean; defaultBranch: string; cloneUrl: string; }

export interface FlowStep {
  nodeId: string;
  name: string;
  filePath: string | null;
  line: number | null;
  depth: number;
  parentNodeId: string | null;
  confidence: "statically-confirmed" | "framework-derived" | "file-import";
  semanticChain: string[];
}

export interface FlowResult {
  entrypoint: EntryPoint;
  steps: FlowStep[];
  unresolvedCalls: string[];
  truncated: boolean;
  policy: string;
}

export interface RelatedRef { id: string; name: string; archetype: string | null; weight: number; }

export interface WhyResult {
  purpose: string;
  notes: string[];
  usedBy: RelatedRef[];
  dependsOn: RelatedRef[];
  affects: RelatedRef[];
  aiUsed: boolean;
  evidence: string[];
}

export interface FileHistory { firstSeen: string; lastModified: string; commits: number; monthly: Record<string, number>; }

export interface HistoryResult {
  available: boolean;
  reason?: string;
  collecting?: boolean;
  canCollect?: boolean;
  collectedAt?: string;
  range?: { start: string; end: string };
  files: Record<string, FileHistory>;
}
