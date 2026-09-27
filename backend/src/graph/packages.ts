/**
 * Known third-party packages, shared by the tech-stack strip and the 3D map.
 * Categories drive how an import is drawn: Database → data reservoir,
 * External Service → portal outside the system, Framework/Library → not drawn.
 */
export type PackageCategory = "Database" | "External Service" | "Framework" | "Library";

export interface PackageInfo {
  match: RegExp;
  name: string;
  category: PackageCategory;
  /** Show in the tech-stack strip (the strip predates the 3D map; keep its list stable). */
  stackChip: boolean;
}

export const KNOWN_PACKAGES: PackageInfo[] = [
  // Frameworks (tech-stack strip)
  { match: /^react-native$|^expo$/, name: "React Native", category: "Framework", stackChip: true },
  { match: /^next$/, name: "Next.js", category: "Framework", stackChip: true },
  { match: /^react$/, name: "React", category: "Framework", stackChip: true },
  { match: /^vue$/, name: "Vue", category: "Framework", stackChip: true },
  { match: /^svelte$/, name: "Svelte", category: "Framework", stackChip: true },
  { match: /^@angular\/core$/, name: "Angular", category: "Framework", stackChip: true },
  { match: /^express$/, name: "Express", category: "Framework", stackChip: true },
  { match: /^fastify$/, name: "Fastify", category: "Framework", stackChip: true },
  { match: /^@nestjs\/core$/, name: "NestJS", category: "Framework", stackChip: true },
  { match: /^koa$/, name: "Koa", category: "Framework", stackChip: true },
  { match: /^tailwindcss$/, name: "Tailwind CSS", category: "Framework", stackChip: true },
  { match: /^vite$/, name: "Vite", category: "Framework", stackChip: true },

  // Databases / ORMs
  { match: /^prisma$|^@prisma\/client$/, name: "Prisma", category: "Database", stackChip: true },
  { match: /^typeorm$/, name: "TypeORM", category: "Database", stackChip: true },
  { match: /^mongoose$/, name: "Mongoose", category: "Database", stackChip: true },
  { match: /^pg$|^postgres$|^@neondatabase\/serverless$|^psycopg2?$|^psycopg$|^asyncpg$|^Npgsql/, name: "PostgreSQL", category: "Database", stackChip: false },
  { match: /^mysql2?$|^pymysql$|^MySql\./, name: "MySQL", category: "Database", stackChip: false },
  { match: /^sqlite3$|^better-sqlite3$|^Microsoft\.Data\.Sqlite/, name: "SQLite", category: "Database", stackChip: false },
  { match: /^mongodb$|^pymongo$|^motor$|^MongoDB\.Driver/, name: "MongoDB", category: "Database", stackChip: false },
  { match: /^redis$|^ioredis$|^StackExchange\.Redis/, name: "Redis", category: "Database", stackChip: false },
  { match: /^neo4j-driver$|^neo4j$/, name: "Neo4j", category: "Database", stackChip: false },
  { match: /^sequelize$/, name: "Sequelize", category: "Database", stackChip: false },
  { match: /^drizzle-orm$/, name: "Drizzle", category: "Database", stackChip: false },
  { match: /^knex$/, name: "Knex", category: "Database", stackChip: false },
  { match: /^@supabase\/supabase-js$|^supabase$/, name: "Supabase", category: "Database", stackChip: false },
  { match: /^sqlalchemy(\.|$)/, name: "SQLAlchemy", category: "Database", stackChip: false },
  { match: /^Microsoft\.EntityFrameworkCore/, name: "Entity Framework Core", category: "Database", stackChip: false },
  { match: /^Dapper$|^(System|Microsoft)\.Data\.SqlClient/, name: "SQL Server", category: "Database", stackChip: false },

  // External services
  { match: /^@clerk\//, name: "Clerk (auth)", category: "External Service", stackChip: true },
  { match: /^firebase(-admin)?$/, name: "Firebase", category: "External Service", stackChip: true },
  { match: /^openai$/, name: "OpenAI", category: "External Service", stackChip: false },
  { match: /^@anthropic-ai\/sdk$|^anthropic$/, name: "Anthropic", category: "External Service", stackChip: false },
  { match: /^@google\/generative-ai$|^@google\/genai$|^google\.generativeai$|^google\.genai$/, name: "Google Gemini", category: "External Service", stackChip: false },
  { match: /^stripe$|^Stripe(\.|$)/, name: "Stripe", category: "External Service", stackChip: false },
  { match: /^@aws-sdk\/|^aws-sdk$|^boto3$|^Amazon\./, name: "AWS", category: "External Service", stackChip: false },
  { match: /^Azure\.|^@azure\//, name: "Azure", category: "External Service", stackChip: false },
  { match: /^@sendgrid\/|^sendgrid$/, name: "SendGrid", category: "External Service", stackChip: false },
  { match: /^twilio$|^Twilio(\.|$)/, name: "Twilio", category: "External Service", stackChip: false },
  { match: /^resend$/, name: "Resend", category: "External Service", stackChip: false },
  { match: /^nodemailer$/, name: "Email (SMTP)", category: "External Service", stackChip: false },
  { match: /^@octokit\/|^octokit$/, name: "GitHub API", category: "External Service", stackChip: false },
  { match: /^@sentry\/|^sentry_sdk$/, name: "Sentry", category: "External Service", stackChip: false },
];

/**
 * Reduces an import specifier to its package name, or null for relative paths
 * and language built-ins (those are never external systems).
 */
export function packageNameOf(specifier: string): string | null {
  const s = specifier.trim();
  if (!s || s.startsWith(".") || s.startsWith("/") || s.startsWith("node:")) return null;
  if (s.startsWith("@")) {
    const [scope, name] = s.split("/");
    return name ? `${scope}/${name}` : null;
  }
  return s.split("/")[0];
}

export function classifyPackage(specifier: string): PackageInfo | null {
  const pkg = packageNameOf(specifier);
  if (!pkg) return null;
  return KNOWN_PACKAGES.find((p) => p.match.test(pkg)) ?? null;
}
