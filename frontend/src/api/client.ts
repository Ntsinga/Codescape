import type { ArchitectureResult, DiagramResult, ExplainResult, FlowResult, GitHubRepo, GraphEdge, GraphNode, HistoryResult, ImpactResult, RepoSummary, RiskResult, SemanticTree, StackResult, WhyResult } from "./types";

// In production this points at the deployed backend (set at build time); in dev
// it stays "/api" and Vite's proxy (vite.config.ts) forwards it to localhost:4000.
const BASE = `${import.meta.env.VITE_API_BASE ?? ""}/api`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Set once from a component inside <ClerkProvider> (see App.tsx) so this plain
 * module — which has no access to React hooks — can still attach the signed-in
 * user's session token to every request. The backend verifies it per-request;
 * nothing here is trusted client-side.
 */
let getAuthToken: (() => Promise<string | null>) | null = null;
export function setAuthTokenGetter(fn: (() => Promise<string | null>) | null): void {
  getAuthToken = fn;
}

/**
 * On a free hosting tier the backend sleeps after ~15 min idle and takes 30-60s
 * to wake; during that window requests fail at the network layer (a `fetch`
 * TypeError, surfaced in the browser as a CORS error because the 502 wake-up page
 * carries no CORS headers). We retry those transient network failures a few times
 * so a cold start is a short wait, not an error.
 *
 * This retry is only safe for idempotent requests (reads, or writes the server
 * already de-dupes). For a request that kicks off real, expensive server-side work
 * with no de-dup (e.g. a GitHub import), retrying a "failed" request that actually
 * just landed on a struggling server means firing that same expensive job again —
 * concurrently with the first one, in the same process. Pass `retryable: false`
 * for those so a slow/erroring attempt fails fast instead of piling up duplicates.
 */
/** An error response from the API, with its HTTP status so callers can branch on it. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit, opts: { retryable?: boolean } = {}): Promise<T> {
  const url = `${BASE}${path}`;
  const maxNetworkRetries = opts.retryable === false ? 0 : 4;
  const token = await getAuthToken?.().catch(() => null);
  const authedInit: RequestInit = token
    ? { ...init, headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` } }
    : init ?? {};
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, authedInit);
    } catch (err) {
      // Network-level failure (server asleep / unreachable). Retry with backoff.
      if (attempt < maxNetworkRetries) {
        await sleep(1500 + attempt * 2000);
        continue;
      }
      throw new Error("Can't reach the server. It may be waking up (free tier can take ~30-60s) — please try again in a moment.");
    }
    // A 502/503 during wake-up: retry a couple of times before giving up.
    if ((res.status === 502 || res.status === 503) && attempt < maxNetworkRetries) {
      await sleep(1500 + attempt * 2000);
      continue;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new ApiError(body.error ?? `Request failed: ${res.status}`, res.status);
    }
    return res.json() as Promise<T>;
  }
}

/** Wakes the backend (fire-and-forget) so it's warm by the time the user acts. */
export function warmup(): void {
  fetch(`${BASE}/health`).catch(() => undefined);
}

export async function uploadRepo(file: File, name: string): Promise<{ repoId: string; fileCount: number; symbolCount: number }> {
  const form = new FormData();
  form.append("archive", file);
  form.append("name", name);
  // Not retryable: a "failed" upload may have already started the (expensive, non-idempotent)
  // import pipeline server-side. Retrying would race a duplicate run against it.
  return request("/repos", { method: "POST", body: form }, { retryable: false });
}

export function listRepos(): Promise<RepoSummary[]> {
  return request("/repos");
}

export function getRepo(id: string): Promise<RepoSummary> {
  return request(`/repos/${id}`);
}

export function deleteRepo(id: string): Promise<{ ok: boolean }> {
  return request(`/repos/${id}`, { method: "DELETE" });
}

export function getGraph(repoId: string): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  return request(`/repos/${repoId}/graph`);
}

export function getNodeDetail(
  repoId: string,
  nodeId: string
): Promise<{ node: GraphNode; children: GraphNode[]; incoming: GraphEdge[]; outgoing: GraphEdge[] }> {
  return request(`/repos/${repoId}/nodes/${nodeId}`);
}

export function searchNodes(repoId: string, q: string): Promise<GraphNode[]> {
  return request(`/repos/${repoId}/search?q=${encodeURIComponent(q)}`);
}

export function getSource(repoId: string, filePath: string): Promise<{ path: string; content: string }> {
  return request(`/repos/${repoId}/source?path=${encodeURIComponent(filePath)}`);
}

export function explainNode(repoId: string, nodeId: string): Promise<ExplainResult> {
  return request(`/repos/${repoId}/nodes/${nodeId}/explain`, { method: "POST" });
}

export function getImpact(repoId: string, nodeId: string): Promise<ImpactResult> {
  return request(`/repos/${repoId}/nodes/${nodeId}/impact`);
}

export function analyzeRepository(repoId: string): Promise<ArchitectureResult> {
  return request(`/repos/${repoId}/analyze`, { method: "POST" });
}

export type ProviderName = "openai" | "gemini" | "deepseek";
export interface AiModels {
  providers: ProviderName[];
  models: Record<ProviderName, string[]>;
  current: { provider: ProviderName; model: string };
}
export function getAiModels(): Promise<AiModels> { return request(`/ai/models`); }
export function selectAiModel(provider: ProviderName, model: string): Promise<{ current: { provider: ProviderName; model: string } }> {
  return request(`/ai/select`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, model }) });
}

export function getSemantic(repoId: string): Promise<SemanticTree> { return request(`/repos/${repoId}/semantic`); }
export function getStack(repoId: string): Promise<StackResult> { return request(`/repos/${repoId}/stack`); }
export function decomposeRepository(repoId: string, enrich = true): Promise<SemanticTree> {
  return request(`/repos/${repoId}/decompose?enrich=${enrich}`, { method: "POST" });
}
export function getFlow(repoId: string, entrypointId: string): Promise<FlowResult> {
  return request(`/repos/${repoId}/flows/${encodeURIComponent(entrypointId)}`);
}
export function explainWhy(repoId: string, semanticNodeId: string): Promise<WhyResult> {
  return request(`/repos/${repoId}/semantic/${encodeURIComponent(semanticNodeId)}/explain`, { method: "POST" });
}
export function getHistory(repoId: string): Promise<HistoryResult> { return request(`/repos/${repoId}/history`); }
export function collectHistory(repoId: string): Promise<{ ok: true }> {
  return request(`/github/history`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repoId }) });
}
export function getDiagrams(repoId: string): Promise<DiagramResult> { return request(`/repos/${repoId}/diagrams`); }
export function getRisks(repoId: string): Promise<RiskResult> { return request(`/repos/${repoId}/risks`); }
// GitHub connections are per-user server-side (keyed to the signed-in Clerk
// user), so these no longer take a "connection" id — auth alone identifies it.
export function listGitHubRepos(): Promise<GitHubRepo[]> { return request(`/github/repos`); }
/** Starts GitHub OAuth; the caller navigates the browser to the returned github.com URL. */
export function getGitHubConnectUrl(): Promise<{ url: string }> {
  return request(`/github/connect-url`, { method: "POST" }, { retryable: false });
}
export function importGitHubRepo(fullName: string, branch: string): Promise<{ repoId: string; fileCount: number; symbolCount: number }> {
  const [owner, repo] = fullName.split("/");
  // Not retryable: see uploadRepo above — a duplicate retry means a second full
  // import pipeline running concurrently with the first in the same 512MB process.
  return request(
    `/github/import`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ owner, repo, branch }) },
    { retryable: false }
  );
}
export function reimportGitHubRepo(repoId: string): Promise<{ repoId: string; fileCount: number; symbolCount: number }> {
  return request(
    `/github/reimport`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repoId }) },
    { retryable: false }
  );
}
