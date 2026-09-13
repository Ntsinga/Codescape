import type Parser from "web-tree-sitter";
import type { Language, ParsedFile, ParsedImport, ParsedSymbol } from "../graph/types.js";
import { grammarKeyFor, getParser, getQuery, type GrammarKey } from "./treeSitter.js";
import { DEFINITION_QUERIES, CALL_QUERIES, IMPORT_QUERIES } from "./queries.js";

const queryCache = new Map<string, Parser.Query>();

async function cachedQuery(key: GrammarKey, kind: "def" | "call" | "import", source: string): Promise<Parser.Query> {
  const cacheKey = `${key}:${kind}`;
  let q = queryCache.get(cacheKey);
  if (!q) {
    q = await getQuery(key, source);
    queryCache.set(cacheKey, q);
  }
  return q;
}

function line1(node: Parser.SyntaxNode): number {
  return node.startPosition.row + 1;
}

function collectByType(node: Parser.SyntaxNode, types: Set<string>, acc: Parser.SyntaxNode[] = []): Parser.SyntaxNode[] {
  if (types.has(node.type)) acc.push(node);
  for (const child of node.namedChildren) {
    if (child) collectByType(child, types, acc);
  }
  return acc;
}

function stripQuotes(text: string): string {
  return text.replace(/^['"`]|['"`]$/g, "");
}

function extractJsImport(node: Parser.SyntaxNode): ParsedImport {
  const sourceNode = node.childForFieldName("source");
  const source = sourceNode ? stripQuotes(sourceNode.text) : "";
  const names: string[] = [];
  for (const spec of collectByType(node, new Set(["import_specifier"]))) {
    const nameNode = spec.childForFieldName("name");
    if (nameNode) names.push(nameNode.text);
  }
  for (const ns of collectByType(node, new Set(["namespace_import"]))) {
    names.push(`* as ${ns.text.replace(/^\*\s*as\s*/, "")}`);
  }
  return { source, importedNames: names, line: line1(node) };
}

function extractPythonImport(node: Parser.SyntaxNode): ParsedImport {
  if (node.type === "import_statement") {
    const dotted = collectByType(node, new Set(["dotted_name"]));
    const source = dotted[0]?.text ?? node.text;
    return { source, importedNames: [], line: line1(node) };
  }
  // import_from_statement
  const moduleNode = node.childForFieldName("module_name");
  const source = moduleNode?.text ?? "";
  const names: string[] = [];
  const dottedNames = collectByType(node, new Set(["dotted_name"]));
  for (const d of dottedNames) {
    if (d !== moduleNode && !(moduleNode && moduleNode.text === d.text && d.startIndex === moduleNode.startIndex)) {
      names.push(d.text);
    }
  }
  return { source, importedNames: names, line: line1(node) };
}

function extractCSharpImport(node: Parser.SyntaxNode): ParsedImport {
  const nameChild = node.namedChildren.find((c) => c && (c.type === "identifier" || c.type === "qualified_name"));
  return { source: nameChild?.text ?? node.text.replace(/^using\s+/, "").replace(/;$/, ""), importedNames: [], line: line1(node) };
}

/** Parses a single source file into symbols/imports/calls using the deterministic tree-sitter layer. */
export async function parseFile(relativePath: string, language: Language, sourceText: string): Promise<ParsedFile | null> {
  const key = grammarKeyFor(language, relativePath);
  if (!key) return null;

  const parser = await getParser(key);
  const tree = parser.parse(sourceText);
  const root = tree.rootNode;

  const defQuery = await cachedQuery(key, "def", DEFINITION_QUERIES[key]);
  const callQuery = await cachedQuery(key, "call", CALL_QUERIES[key]);
  const importQuery = await cachedQuery(key, "import", IMPORT_QUERIES[key]);

  interface RawDef { kind: ParsedSymbol["kind"]; name: string; node: Parser.SyntaxNode }
  const rawDefs: RawDef[] = [];
  for (const match of defQuery.matches(root)) {
    let kind: ParsedSymbol["kind"] | null = null;
    let nameText: string | null = null;
    let defNode: Parser.SyntaxNode | null = null;
    for (const cap of match.captures) {
      if (cap.name === "class.def" || cap.name === "interface.def" || cap.name === "function.def" || cap.name === "method.def") {
        defNode = cap.node;
        kind = cap.name.startsWith("class") ? "Class" : cap.name.startsWith("interface") ? "Interface" : "Function";
      }
      if (cap.name.endsWith(".name")) nameText = cap.node.text;
    }
    if (kind && nameText && defNode) rawDefs.push({ kind, name: nameText, node: defNode });
  }

  const callCaptures = callQuery.captures(root).filter((c) => c.name === "call.name");

  const symbols: ParsedSymbol[] = rawDefs.map((def) => ({
    kind: def.kind,
    name: def.name,
    startLine: line1(def.node),
    endLine: def.node.endPosition.row + 1,
    calls: [],
  }));

  // Sort by range size ascending so the innermost enclosing symbol is matched first (methods before their class).
  const withRange = rawDefs
    .map((def, idx) => ({ idx, start: def.node.startIndex, end: def.node.endIndex }))
    .sort((a, b) => a.end - a.start - (b.end - b.start));

  const topLevelCalls: string[] = [];
  for (const call of callCaptures) {
    const pos = call.node.startIndex;
    const owner = withRange.find((d) => pos >= d.start && pos <= d.end);
    if (owner) {
      symbols[owner.idx].calls.push(call.node.text);
    } else {
      topLevelCalls.push(call.node.text);
    }
  }

  const imports: ParsedImport[] = [];
  for (const match of importQuery.matches(root)) {
    const defCap = match.captures.find((c) => c.name === "import.def");
    if (!defCap) continue;
    if (key === "python") {
      imports.push(extractPythonImport(defCap.node));
    } else if (key === "csharp") {
      imports.push(extractCSharpImport(defCap.node));
    } else {
      imports.push(extractJsImport(defCap.node));
    }
  }

  return { path: relativePath, language, symbols, imports, topLevelCalls };
}
