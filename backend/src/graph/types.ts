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

export type Language = "typescript" | "javascript" | "python" | "csharp" | "unknown";

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
  language: Language | null;
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

export interface EvidenceRef {
  file: string;
  startLine: number;
  endLine: number;
}

export interface ParsedSymbol {
  kind: "Class" | "Interface" | "Function";
  name: string;
  startLine: number;
  endLine: number;
  /** Function/method calls made from within this symbol's body, by identifier name */
  calls: string[];
}

export interface ParsedImport {
  /** Raw imported module/namespace specifier as written in source */
  source: string;
  /** Named symbols imported, if resolvable (e.g. `import { foo } from './x'`) */
  importedNames: string[];
  line: number;
}

export interface ParsedFile {
  path: string; // relative to repo root, posix-style
  language: Language;
  symbols: ParsedSymbol[];
  imports: ParsedImport[];
  /** Top-level (module-scope) calls, not attributed to a symbol */
  topLevelCalls: string[];
}
