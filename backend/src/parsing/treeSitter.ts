import path from "node:path";
import { fileURLToPath } from "node:url";
import Parser from "web-tree-sitter";
import type { Language } from "../graph/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WASM_DIR = path.resolve(__dirname, "..", "..", "node_modules", "tree-sitter-wasms", "out");

/** Grammar key used to look up queries/wasm file; distinct from our Language type for tsx. */
export type GrammarKey = "typescript" | "tsx" | "javascript" | "python" | "csharp";

const GRAMMAR_FILES: Record<GrammarKey, string> = {
  typescript: "tree-sitter-typescript.wasm",
  tsx: "tree-sitter-tsx.wasm",
  javascript: "tree-sitter-javascript.wasm",
  python: "tree-sitter-python.wasm",
  csharp: "tree-sitter-c_sharp.wasm",
};

let initPromise: Promise<void> | null = null;
const languageCache = new Map<GrammarKey, Parser.Language>();
const parserCache = new Map<GrammarKey, Parser>();

function initTreeSitter(): Promise<void> {
  if (!initPromise) initPromise = Parser.init();
  return initPromise;
}

export function grammarKeyFor(language: Language, filePath: string): GrammarKey | null {
  if (language === "typescript") {
    return filePath.endsWith(".tsx") ? "tsx" : "typescript";
  }
  if (language === "javascript") return "javascript";
  if (language === "python") return "python";
  if (language === "csharp") return "csharp";
  return null;
}

async function getLanguage(key: GrammarKey): Promise<Parser.Language> {
  await initTreeSitter();
  let lang = languageCache.get(key);
  if (!lang) {
    lang = await Parser.Language.load(path.join(WASM_DIR, GRAMMAR_FILES[key]));
    languageCache.set(key, lang);
  }
  return lang;
}

export async function getParser(key: GrammarKey): Promise<Parser> {
  let parser = parserCache.get(key);
  if (!parser) {
    const lang = await getLanguage(key);
    parser = new Parser();
    parser.setLanguage(lang);
    parserCache.set(key, parser);
  }
  return parser;
}

export async function getQuery(key: GrammarKey, source: string): Promise<Parser.Query> {
  const lang = await getLanguage(key);
  return lang.query(source);
}
