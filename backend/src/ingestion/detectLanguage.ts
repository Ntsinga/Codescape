import type { Language } from "../graph/types.js";

const EXTENSION_MAP: Record<string, Language> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".pyi": "python",
  ".cs": "csharp",
};

export function detectLanguageByExtension(filePath: string): Language {
  const dot = filePath.lastIndexOf(".");
  if (dot === -1) return "unknown";
  const ext = filePath.slice(dot).toLowerCase();
  return EXTENSION_MAP[ext] ?? "unknown";
}

export interface FrameworkSignal {
  file: string;
  signal: string;
}

/** Best-effort framework/project-type detection from well-known marker files. */
export function detectFrameworkSignals(relativeFilePaths: string[]): FrameworkSignal[] {
  const signals: FrameworkSignal[] = [];
  const has = (name: string) => relativeFilePaths.some((p) => p.toLowerCase().endsWith(name));

  if (has("package.json")) signals.push({ file: "package.json", signal: "Node.js project" });
  if (relativeFilePaths.some((p) => /\.csproj$/i.test(p))) {
    signals.push({ file: "*.csproj", signal: ".NET project" });
  }
  if (has("requirements.txt")) signals.push({ file: "requirements.txt", signal: "Python project" });
  if (has("pyproject.toml")) signals.push({ file: "pyproject.toml", signal: "Python project" });
  if (relativeFilePaths.some((p) => /\.sln$/i.test(p))) {
    signals.push({ file: "*.sln", signal: ".NET solution" });
  }
  return signals;
}
