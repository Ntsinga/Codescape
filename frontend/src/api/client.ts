import type { ArchitectureResult, DiagramResult, ExplainResult, GitHubRepo, GraphEdge, GraphNode, ImpactResult, RepoSummary, RiskResult, SemanticTree, StackResult } from "./types";

const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function uploadRepo(file: File, name: string): Promise<{ repoId: string; fileCount: number; symbolCount: number }> {
  const form = new FormData();
  form.append("archive", file);
  form.append("name", name);
  return request("/repos", { method: "POST", body: form });
}

export function listRepos(): Promise<RepoSummary[]> {
  return request("/repos");
}

export function getRepo(id: string): Promise<RepoSummary> {
  return request(`/repos/${id}`);
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

export interface AiModels {
  providers: Array<"openai" | "gemini">;
  models: { openai: string[]; gemini: string[] };
  current: { provider: "openai" | "gemini"; model: string };
}
export function getAiModels(): Promise<AiModels> { return request(`/ai/models`); }
export function selectAiModel(provider: "openai" | "gemini", model: string): Promise<{ current: { provider: string; model: string } }> {
  return request(`/ai/select`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, model }) });
}

export function getSemantic(repoId: string): Promise<SemanticTree> { return request(`/repos/${repoId}/semantic`); }
export function getStack(repoId: string): Promise<StackResult> { return request(`/repos/${repoId}/stack`); }
export function decomposeRepository(repoId: string, enrich = true): Promise<SemanticTree> {
  return request(`/repos/${repoId}/decompose?enrich=${enrich}`, { method: "POST" });
}
export function getDiagrams(repoId: string): Promise<DiagramResult> { return request(`/repos/${repoId}/diagrams`); }
export function getRisks(repoId: string): Promise<RiskResult> { return request(`/repos/${repoId}/risks`); }
export function listGitHubRepos(connection: string): Promise<GitHubRepo[]> { return request(`/github/repos?connection=${encodeURIComponent(connection)}`); }
export function importGitHubRepo(connection: string, fullName: string, branch: string): Promise<{ repoId: string; fileCount: number; symbolCount: number }> {
  const [owner, repo] = fullName.split("/");
  return request(`/github/import?connection=${encodeURIComponent(connection)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ owner, repo, branch }) });
}
export function reimportGitHubRepo(connection: string, repoId: string): Promise<{ repoId: string; fileCount: number; symbolCount: number }> {
  return request(`/github/reimport?connection=${encodeURIComponent(connection)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repoId }) });
}
