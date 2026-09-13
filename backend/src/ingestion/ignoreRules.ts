const IGNORED_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  "coverage",
  "venv",
  ".venv",
  "__pycache__",
  ".mypy_cache",
  ".pytest_cache",
  "bin",
  "obj",
  ".vs",
  ".idea",
  ".vscode",
  "target",
]);

const IGNORED_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".svg",
  ".pdf", ".zip", ".tar", ".gz", ".7z", ".rar",
  ".mp3", ".mp4", ".mov", ".avi", ".wav",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".exe", ".dll", ".so", ".dylib", ".bin", ".pdb",
  ".lock",
  ".min.js", ".min.css",
]);

/** Files whose contents must never be sent to an LLM (secrets, credentials). */
const SECRET_LIKE_NAMES = [
  /^\.env(\..*)?$/i,
  /^.*\.pem$/i,
  /^.*\.key$/i,
  /^id_rsa.*$/i,
  /^credentials(\.json)?$/i,
  /^.*service[-_]account.*\.json$/i,
  /^secrets?\.(ya?ml|json)$/i,
];

const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2MB per source file
const MAX_TOTAL_BYTES = 300 * 1024 * 1024; // 300MB per repo, uncompressed
const MAX_FILE_COUNT = 50_000;
// File content is persisted in Postgres (for the source viewer/AI, since Render's
// free tier has no persistent disk) — capped well under Neon's free storage tier
// so a handful of imported repos don't exhaust it.
const MAX_STORED_CONTENT_BYTES = 50 * 1024 * 1024; // 50MB of source text per repo

export function isIgnoredDir(dirName: string): boolean {
  return IGNORED_DIR_NAMES.has(dirName) || dirName.startsWith(".");
}

export function isIgnoredFile(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  for (const ext of IGNORED_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  const baseName = relativePath.split(/[/\\]/).pop() ?? relativePath;
  if (baseName.startsWith(".")) return true;
  return false;
}

export function isSecretLike(relativePath: string): boolean {
  const baseName = relativePath.split(/[/\\]/).pop() ?? relativePath;
  return SECRET_LIKE_NAMES.some((re) => re.test(baseName));
}

export const limits = { MAX_FILE_BYTES, MAX_TOTAL_BYTES, MAX_FILE_COUNT, MAX_STORED_CONTENT_BYTES };
