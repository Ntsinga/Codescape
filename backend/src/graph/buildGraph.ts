import { nanoid } from "nanoid";
import path from "node:path";
import type { GraphEdge, GraphNode, Language, ParsedFile } from "./types.js";

export interface FileInput {
  relativePath: string; // posix-style
  language: Language;
}

export interface BuildGraphResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".py", ".pyi", ".cs"]);

function newId(): string {
  return nanoid(12);
}

/**
 * Builds the common node/edge graph for a repository from its file list and
 * per-file parse results. Containment (folders/files/symbols) and imports are
 * always statically-confirmed; call edges are labeled by how they were resolved.
 */
export function buildGraph(repoId: string, repoName: string, files: FileInput[], parsedByPath: Map<string, ParsedFile>): BuildGraphResult {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const repoNode: GraphNode = {
    id: repoId,
    repoId,
    type: "Repository",
    name: repoName,
    parentId: null,
    fileId: null,
    filePath: null,
    startLine: null,
    endLine: null,
    language: null,
    metadata: {},
  };
  nodes.push(repoNode);

  // ---- Folders + Files ----
  const folderIdByPath = new Map<string, string>(); // posix folder path -> node id
  const fileIdByPath = new Map<string, string>(); // posix file path -> node id

  function ensureFolder(folderPath: string): string {
    if (folderPath === "") return repoId;
    const existing = folderIdByPath.get(folderPath);
    if (existing) return existing;
    const parentPath = folderPath.includes("/") ? folderPath.slice(0, folderPath.lastIndexOf("/")) : "";
    const parentId = ensureFolder(parentPath);
    const id = newId();
    folderIdByPath.set(folderPath, id);
    nodes.push({
      id,
      repoId,
      type: "Folder",
      name: folderPath.split("/").pop() ?? folderPath,
      parentId,
      fileId: null,
      filePath: folderPath,
      startLine: null,
      endLine: null,
      language: null,
      metadata: {},
    });
    edges.push(makeEdge(repoId, parentId, id, "Contains", "statically-confirmed", []));
    return id;
  }

  const sortedFiles = [...files].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  for (const f of sortedFiles) {
    const dir = f.relativePath.includes("/") ? f.relativePath.slice(0, f.relativePath.lastIndexOf("/")) : "";
    const parentId = ensureFolder(dir);
    const id = newId();
    fileIdByPath.set(f.relativePath, id);
    nodes.push({
      id,
      repoId,
      type: "File",
      name: f.relativePath.split("/").pop() ?? f.relativePath,
      parentId,
      fileId: id,
      filePath: f.relativePath,
      startLine: null,
      endLine: null,
      language: f.language,
      metadata: {},
    });
    edges.push(makeEdge(repoId, parentId, id, "Contains", "statically-confirmed", []));
  }

  // ---- Symbols (classes/interfaces/functions), nested by line-range containment ----
  // symbolKey: `${filePath}::${symbolIndexInFile}` -> node id, plus name index for call resolution
  const symbolNodeIdByFileAndIndex = new Map<string, string>();
  const symbolNamesByFile = new Map<string, Map<string, string[]>>(); // filePath -> name -> nodeIds

  for (const [filePath, parsed] of parsedByPath) {
    const fileNodeId = fileIdByPath.get(filePath);
    if (!fileNodeId) continue;

    const ranges = parsed.symbols.map((s) => ({ start: s.startLine, end: s.endLine }));
    const symbolIds: string[] = [];
    const nameIndex = new Map<string, string[]>();

    // Innermost enclosing symbol (excluding self) becomes the parent, else the file.
    // Parent ranges always strictly contain child ranges, and containing symbols are
    // always matched (and thus indexed) before the symbols nested inside them, so
    // bestParentIdx < i always holds here.
    function findParentIdx(i: number): number {
      let bestParentIdx = -1;
      let bestSize = Infinity;
      for (let j = 0; j < parsed.symbols.length; j++) {
        if (j === i) continue;
        const r = ranges[j];
        if (r.start <= ranges[i].start && r.end >= ranges[i].end) {
          const size = r.end - r.start;
          if (size < bestSize) {
            bestSize = size;
            bestParentIdx = j;
          }
        }
      }
      return bestParentIdx;
    }

    for (let i = 0; i < parsed.symbols.length; i++) {
      const sym = parsed.symbols[i];
      const bestParentIdx = findParentIdx(i);
      const id = newId();
      symbolIds.push(id);
      const parentNodeId = bestParentIdx === -1 ? fileNodeId : symbolIds[bestParentIdx];
      nodes.push({
        id,
        repoId,
        type: sym.kind,
        name: sym.name,
        parentId: parentNodeId,
        fileId: fileNodeId,
        filePath,
        startLine: sym.startLine,
        endLine: sym.endLine,
        language: parsed.language,
        metadata: {},
      });
      edges.push(makeEdge(repoId, parentNodeId, id, "Contains", "statically-confirmed", [
        { file: filePath, startLine: sym.startLine, endLine: sym.endLine },
      ]));
      symbolNodeIdByFileAndIndex.set(`${filePath}::${i}`, id);
      const list = nameIndex.get(sym.name) ?? [];
      list.push(id);
      nameIndex.set(sym.name, list);
    }

    symbolNamesByFile.set(filePath, nameIndex);
  }

  // ---- Imports ----
  const importedModuleIdByKey = new Map<string, string>(); // `${filePath}::${source}` -> node id
  // resolvedFileByImport: filePath -> source string -> resolved repo-relative file path
  const resolvedFileByImport = new Map<string, Map<string, string>>();

  for (const [filePath, parsed] of parsedByPath) {
    const fileNodeId = fileIdByPath.get(filePath);
    if (!fileNodeId) continue;
    const resolved = new Map<string, string>();
    resolvedFileByImport.set(filePath, resolved);

    for (const imp of parsed.imports) {
      const targetPath = resolveImportToFile(filePath, imp.source, parsed.language, fileIdByPath);
      if (targetPath) {
        resolved.set(imp.source, targetPath);
        const targetId = fileIdByPath.get(targetPath)!;
        edges.push(
          makeEdge(repoId, fileNodeId, targetId, "Imports", "statically-confirmed", [
            { file: filePath, startLine: imp.line, endLine: imp.line },
          ])
        );
      } else {
        const key = `${filePath}::${imp.source}`;
        let moduleId = importedModuleIdByKey.get(key);
        if (!moduleId) {
          moduleId = newId();
          importedModuleIdByKey.set(key, moduleId);
          nodes.push({
            id: moduleId,
            repoId,
            type: "ImportedModule",
            name: imp.source,
            parentId: fileNodeId,
            fileId: fileNodeId,
            filePath: null,
            startLine: null,
            endLine: null,
            language: null,
            metadata: { importedNames: imp.importedNames },
          });
        }
        edges.push(
          makeEdge(repoId, fileNodeId, moduleId, "Imports", "statically-confirmed", [
            { file: filePath, startLine: imp.line, endLine: imp.line },
          ])
        );
      }
    }
  }

  // ---- Calls ----
  for (const [filePath, parsed] of parsedByPath) {
    const fileNodeId = fileIdByPath.get(filePath);
    if (!fileNodeId) continue;
    const sameFileNames = symbolNamesByFile.get(filePath) ?? new Map();
    const resolvedImports = resolvedFileByImport.get(filePath) ?? new Map();

    for (let i = 0; i < parsed.symbols.length; i++) {
      const callerNodeId = symbolNodeIdByFileAndIndex.get(`${filePath}::${i}`);
      if (!callerNodeId) continue;
      for (const calleeName of parsed.symbols[i].calls) {
        resolveAndAddCallEdge(calleeName, filePath, callerNodeId, sameFileNames, resolvedImports, symbolNamesByFile, repoId, edges);
      }
    }
    for (const calleeName of parsed.topLevelCalls) {
      resolveAndAddCallEdge(calleeName, filePath, fileNodeId, sameFileNames, resolvedImports, symbolNamesByFile, repoId, edges);
    }
  }

  return { nodes, edges };
}

function resolveAndAddCallEdge(
  calleeName: string,
  filePath: string,
  callerNodeId: string,
  sameFileNames: Map<string, string[]>,
  resolvedImports: Map<string, string>,
  symbolNamesByFile: Map<string, Map<string, string[]>>,
  repoId: string,
  edges: GraphEdge[]
): void {
  // 1) Same-file resolution: statically confirmed.
  const sameFile = sameFileNames.get(calleeName);
  if (sameFile && sameFile.length > 0) {
    for (const targetId of sameFile) {
      if (targetId === callerNodeId) continue;
      edges.push(makeEdge(repoId, callerNodeId, targetId, "Calls", "statically-confirmed", [{ file: filePath, startLine: 0, endLine: 0 }]));
    }
    return;
  }
  // 2) Cross-file resolution via a resolved import: framework-derived (name-matched, not type-checked).
  for (const targetFile of resolvedImports.values()) {
    const names = symbolNamesByFile.get(targetFile);
    const targetIds = names?.get(calleeName);
    if (targetIds && targetIds.length > 0) {
      for (const targetId of targetIds) {
        edges.push(makeEdge(repoId, callerNodeId, targetId, "Calls", "framework-derived", [{ file: filePath, startLine: 0, endLine: 0 }]));
      }
      return;
    }
  }
  // 3) Unresolved: omit rather than guess (evidence-before-inference principle).
}

function makeEdge(
  repoId: string,
  fromNodeId: string,
  toNodeId: string,
  type: GraphEdge["type"],
  confidence: GraphEdge["confidence"],
  evidence: GraphEdge["evidence"]
): GraphEdge {
  return { id: newId(), repoId, fromNodeId, toNodeId, type, confidence, evidence };
}

/** Attempts to resolve a relative/module import specifier to an actual file in the repo. */
function resolveImportToFile(fromFile: string, source: string, language: Language, fileIdByPath: Map<string, string>): string | null {
  const dir = fromFile.includes("/") ? fromFile.slice(0, fromFile.lastIndexOf("/")) : "";

  if (language === "typescript" || language === "javascript") {
    if (!source.startsWith(".")) return null; // bare package specifier, not in-repo
    const base = path.posix.normalize(path.posix.join(dir, source));
    const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}/index.ts`, `${base}/index.tsx`, `${base}/index.js`];
    for (const c of candidates) {
      const norm = c.replace(/^\.\//, "");
      if (fileIdByPath.has(norm)) return norm;
    }
    return null;
  }

  if (language === "python") {
    // best-effort: dotted module path relative to repo root, e.g. mypkg.util -> mypkg/util.py
    const asPath = source.replace(/\./g, "/");
    const candidates = [`${asPath}.py`, `${asPath}/__init__.py`];
    for (const c of candidates) {
      if (fileIdByPath.has(c)) return c;
    }
    return null;
  }

  // C# using directives reference namespaces, not files; no reliable static file resolution here.
  return null;
}
