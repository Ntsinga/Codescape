import fs from "node:fs";
import path from "node:path";
import { getDb } from "./db.js";
import { repoSourceDir } from "../storage/paths.js";

export interface StackResult {
  languages: Array<{ name: string; files: number }>;
  frameworks: Array<{ name: string; source: string }>;
}

const LANGUAGE_LABELS: Record<string, string> = {
  typescript: "TypeScript",
  javascript: "JavaScript",
  python: "Python",
  csharp: "C#",
};

// Known dependency → framework/library display name, matched by substring.
const DEP_FRAMEWORKS: Array<{ match: RegExp; name: string }> = [
  { match: /^react-native$|^expo$/, name: "React Native" },
  { match: /^next$/, name: "Next.js" },
  { match: /^react$/, name: "React" },
  { match: /^vue$/, name: "Vue" },
  { match: /^svelte$/, name: "Svelte" },
  { match: /^@angular\/core$/, name: "Angular" },
  { match: /^express$/, name: "Express" },
  { match: /^fastify$/, name: "Fastify" },
  { match: /^@nestjs\/core$/, name: "NestJS" },
  { match: /^koa$/, name: "Koa" },
  { match: /^@clerk\//, name: "Clerk (auth)" },
  { match: /^firebase(-admin)?$/, name: "Firebase" },
  { match: /^prisma$|^@prisma\/client$/, name: "Prisma" },
  { match: /^typeorm$/, name: "TypeORM" },
  { match: /^mongoose$/, name: "Mongoose" },
  { match: /^tailwindcss$/, name: "Tailwind CSS" },
  { match: /^vite$/, name: "Vite" },
];

const PY_FRAMEWORKS: Array<{ match: RegExp; name: string }> = [
  { match: /fastapi/i, name: "FastAPI" },
  { match: /flask/i, name: "Flask" },
  { match: /django/i, name: "Django" },
  { match: /sqlalchemy/i, name: "SQLAlchemy" },
  { match: /pydantic/i, name: "Pydantic" },
  { match: /uvicorn/i, name: "Uvicorn" },
  { match: /pytest/i, name: "pytest" },
  { match: /numpy|pandas|torch|tensorflow|scikit-learn/i, name: "ML/Data stack" },
];

function safeRead(root: string, rel: string): string | null {
  try {
    const full = path.resolve(root, rel);
    if (path.relative(root, full).startsWith("..")) return null;
    return fs.readFileSync(full, "utf-8");
  } catch {
    return null;
  }
}

export function computeStack(repoId: string): StackResult {
  const rows = getDb()
    .prepare(`SELECT language, COUNT(*) AS n FROM files WHERE repo_id = ? AND language IS NOT NULL GROUP BY language ORDER BY n DESC`)
    .all(repoId) as Array<{ language: string; n: number }>;
  const languages = rows.map((r) => ({ name: LANGUAGE_LABELS[r.language] ?? r.language, files: r.n }));

  const allFiles = getDb().prepare(`SELECT path FROM files WHERE repo_id = ?`).all(repoId) as Array<{ path: string }>;
  const root = repoSourceDir(repoId);
  const frameworks: StackResult["frameworks"] = [];
  const seen = new Set<string>();
  const add = (name: string, source: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    frameworks.push({ name, source });
  };

  // package.json dependencies
  for (const f of allFiles.filter((f) => f.path.toLowerCase().endsWith("package.json"))) {
    const raw = safeRead(root, f.path);
    if (!raw) continue;
    try {
      const pkg = JSON.parse(raw);
      const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      for (const dep of Object.keys(deps)) {
        const hit = DEP_FRAMEWORKS.find((d) => d.match.test(dep));
        if (hit) add(hit.name, f.path);
      }
    } catch {
      /* ignore malformed package.json */
    }
  }

  // Python requirements / pyproject
  for (const f of allFiles.filter((f) => /requirements.*\.txt$|pyproject\.toml$/i.test(f.path))) {
    const raw = safeRead(root, f.path);
    if (!raw) continue;
    for (const fw of PY_FRAMEWORKS) if (fw.match.test(raw)) add(fw.name, f.path);
  }

  // C# project files
  for (const f of allFiles.filter((f) => /\.csproj$/i.test(f.path))) {
    const raw = safeRead(root, f.path);
    if (!raw) continue;
    if (/Microsoft\.AspNetCore|Sdk="Microsoft\.NET\.Sdk\.Web"/i.test(raw)) add("ASP.NET Core", f.path);
    if (/EntityFrameworkCore/i.test(raw)) add("Entity Framework Core", f.path);
  }

  return { languages, frameworks };
}
