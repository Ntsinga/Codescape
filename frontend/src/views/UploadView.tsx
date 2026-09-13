import { useCallback, useEffect, useRef, useState } from "react";
import { getGraph, getSemantic, importGitHubRepo, listGitHubRepos, listRepos, reimportGitHubRepo, uploadRepo } from "../api/client";
import type { GitHubRepo, RepoSummary } from "../api/types";
import { useExplorerStore } from "../state/store";

export function UploadView() {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>([]);
  const [githubConnection, setGithubConnection] = useState<string | null>(null);
  const [githubLoading, setGithubLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadRepo = useExplorerStore((s) => s.loadRepo);

  const openLoaded = useCallback(
    async (repoId: string, displayName: string) => {
      const [graph, semantic] = await Promise.all([
        getGraph(repoId),
        getSemantic(repoId).catch(() => null),
      ]);
      loadRepo(repoId, displayName, graph, semantic);
    },
    [loadRepo]
  );

  const refreshRepos = useCallback(() => {
    listRepos().then(setRepos).catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshRepos();
    const params = new URLSearchParams(window.location.search);
    const connection = params.get("connection");
    if (params.get("github") === "connected" && connection) {
      setGithubConnection(connection);
      setGithubLoading(true);
      listGitHubRepos(connection).then(setGithubRepos).catch((err) => setError(err instanceof Error ? err.message : "Unable to list GitHub repositories")).finally(() => setGithubLoading(false));
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [refreshRepos]);

  async function importSelectedGitHub(repo: GitHubRepo) {
    if (!githubConnection) return;
    setUploading(true); setError(null);
    try {
      const result = await importGitHubRepo(githubConnection, repo.fullName, repo.defaultBranch);
      await openLoaded(result.repoId, repo.fullName);
    } catch (err) { setError(err instanceof Error ? err.message : "GitHub import failed"); }
    finally { setUploading(false); refreshRepos(); }
  }

  const openRepo = useCallback(
    async (repo: RepoSummary) => {
      if (repo.status !== "ready") return;
      await openLoaded(repo.id, repo.name);
    },
    [openLoaded]
  );

  async function reimport(repo: RepoSummary) {
    if (!githubConnection) {
      setError("Connect GitHub first to re-import (click “Connect GitHub”).");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      await reimportGitHubRepo(githubConnection, repo.id);
      await openLoaded(repo.id, repo.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Re-import failed");
    } finally {
      setUploading(false);
      refreshRepos();
    }
  }

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith(".zip")) {
        setError("Please upload a .zip archive");
        return;
      }
      setUploading(true);
      setError(null);
      try {
        const name = file.name.replace(/\.zip$/i, "");
        const result = await uploadRepo(file, name);
        await openLoaded(result.repoId, name);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploading(false);
        refreshRepos();
      }
    },
    [openLoaded, refreshRepos]
  );

  return (
    <div className="upload-screen">
      <h1>Codescape</h1>
      <p className="tagline">An explorable atlas of any codebase.</p>
      <p className="overview">
        Upload a repo and Codescape maps it into a navigable system model — zoom from
        high-level capabilities down through files and functions to the source itself,
        like an atlas that goes from continents to streets.
      </p>
      <p style={{ color: "var(--text-dim)" }}>Or connect a GitHub repository</p>
      <a href="/api/github/connect"><button type="button">Connect GitHub</button></a>
      <div
        className={`dropzone${dragOver ? " dragover" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file) handleFile(file);
        }}
      >
        {uploading ? (
          <p>Uploading and analyzing…</p>
        ) : (
          <>
            <p>Drag a repository .zip here, or</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
            <button type="button" onClick={() => fileInputRef.current?.click()}>
              Choose file
            </button>
          </>
        )}
        {error && <p style={{ color: "var(--red)" }}>{error}</p>}
      </div>

      {repos.length > 0 && (
        <div className="repo-list">
          <h3>Previously analyzed</h3>
          {repos.map((r) => (
            <div key={r.id} className="repo-row" onClick={() => openRepo(r)}>
              <span>{r.name}</span>
              <span className="repo-row-actions">
                {r.origin?.kind === "github" && (
                  <button
                    type="button"
                    className="row-btn"
                    title={githubConnection ? "Re-fetch latest from GitHub (replaces in place)" : "Connect GitHub to re-import"}
                    onClick={(e) => { e.stopPropagation(); reimport(r); }}
                  >
                    ↻ Re-import
                  </button>
                )}
                <span className={`status-tag ${r.status}`}>{r.status}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {githubConnection && <div className="repo-list"><h3>GitHub repositories</h3>{githubLoading ? <p>Loading repositories…</p> : githubRepos.map((r) => <div key={r.id} className="repo-row" onClick={() => importSelectedGitHub(r)}><span>{r.fullName}</span><span className="status-tag ready">{r.defaultBranch}{r.private ? " · private" : ""}</span></div>)}</div>}
    </div>
  );
}
