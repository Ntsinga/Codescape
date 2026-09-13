import { getPool } from "./db.js";
import { getFileContent } from "./queries.js";

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

export async function computeStack(repoId: string): Promise<StackResult> {
  const pool = getPool();
  const { rows: langRows } = await pool.query(
    `SELECT language, COUNT(*) AS n FROM files WHERE repo_id = $1 AND language IS NOT NULL GROUP BY language ORDER BY n DESC`,
    [repoId]
  );
  const languages = langRows.map((r: any) => ({ name: LANGUAGE_LABELS[r.language] ?? r.language, files: Number(r.n) }));

  const { rows: allFiles } = await pool.query(`SELECT path FROM files WHERE repo_id = $1`, [repoId]);
  const frameworks: StackResult["frameworks"] = [];
  const seen = new Set<string>();
  const add = (name: string, source: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    frameworks.push({ name, source });
  };

  // package.json dependencies
  for (const f of allFiles.filter((f: any) => f.path.toLowerCase().endsWith("package.json"))) {
    const raw = await getFileContent(repoId, f.path);
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
  for (const f of allFiles.filter((f: any) => /requirements.*\.txt$|pyproject\.toml$/i.test(f.path))) {
    const raw = await getFileContent(repoId, f.path);
    if (!raw) continue;
    for (const fw of PY_FRAMEWORKS) if (fw.match.test(raw)) add(fw.name, f.path);
  }

  // C# project files
  for (const f of allFiles.filter((f: any) => /\.csproj$/i.test(f.path))) {
    const raw = await getFileContent(repoId, f.path);
    if (!raw) continue;
    if (/Microsoft\.AspNetCore|Sdk="Microsoft\.NET\.Sdk\.Web"/i.test(raw)) add("ASP.NET Core", f.path);
    if (/EntityFrameworkCore/i.test(raw)) add("Entity Framework Core", f.path);
  }

  return { languages, frameworks };
}
