import { useCallback, useEffect, useRef, useState } from "react";
import { deleteRepo, getGraph, getSemantic, importGitHubRepo, listGitHubRepos, listRepos, reimportGitHubRepo, uploadRepo, warmup } from "../api/client";
import type { GitHubRepo, RepoSummary } from "../api/types";
import { useExplorerStore } from "../state/store";

export function UploadView() {
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); // holds a status message while any load is in flight
  const uploading = busy !== null;
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
    warmup(); // nudge the backend awake so the first real action isn't a cold start
    refreshRepos();
    const params = new URLSearchParams(window.location.search);
    const connection = params.get("connection");
    if (params.get("github") === "error") {
      setError(params.get("message") || "GitHub connection failed.");
      window.history.replaceState({}, "", window.location.pathname);
    } else if (params.get("github") === "connected" && connection) {
      setGithubConnection(connection);
      setGithubLoading(true);
      listGitHubRepos(connection).then(setGithubRepos).catch((err) => setError(err instanceof Error ? err.message : "Unable to list GitHub repositories")).finally(() => setGithubLoading(false));
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [refreshRepos]);

  async function importSelectedGitHub(repo: GitHubRepo) {
    if (!githubConnection) return;
    setBusy(`Importing ${repo.fullName}…`); setError(null);
    try {
      const result = await importGitHubRepo(githubConnection, repo.fullName, repo.defaultBranch);
      await openLoaded(result.repoId, repo.fullName);
    } catch (err) { setError(err instanceof Error ? err.message : "GitHub import failed"); setBusy(null); refreshRepos(); }
  }

  const openRepo = useCallback(
    async (repo: RepoSummary) => {
      if (repo.status !== "ready") return;
      setBusy(`Opening ${repo.name}…`);
      setError(null);
      try {
        await openLoaded(repo.id, repo.name);
        // On success the view switches to the explorer; no need to clear busy.
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to open repository");
        setBusy(null);
      }
    },
    [openLoaded]
  );

  async function reimport(repo: RepoSummary) {
    if (!githubConnection) {
      setError("Connect GitHub first to re-import (click “Connect GitHub”).");
      return;
    }
    setBusy(`Re-importing ${repo.name}…`);
    setError(null);
    try {
      await reimportGitHubRepo(githubConnection, repo.id);
      await openLoaded(repo.id, repo.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Re-import failed");
      setBusy(null);
      refreshRepos();
    }
  }

  async function removeRepo(repo: RepoSummary) {
    if (!window.confirm(`Delete "${repo.name}" and its analysis? This can't be undone.`)) return;
    setError(null);
    try {
      await deleteRepo(repo.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete repository");
    } finally {
      refreshRepos();
    }
  }

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith(".zip")) {
        setError("Please upload a .zip archive");
        return;
      }
      setBusy("Analyzing repository…");
      setError(null);
      try {
        const name = file.name.replace(/\.zip$/i, "");
        const result = await uploadRepo(file, name);
        await openLoaded(result.repoId, name);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
        setBusy(null);
        refreshRepos();
      }
    },
    [openLoaded, refreshRepos]
  );

  const githubConnectUrl = `${import.meta.env.VITE_API_BASE ?? ""}/api/github/connect`;

  return (
    <div className="landing">
      <div className="landing-glow" aria-hidden="true" />

      {busy && (
        <div className="loading-overlay" role="status" aria-live="polite">
          <div className="loading-card">
            <div className="spinner large" aria-hidden="true" />
            <p className="loading-msg">{busy}</p>
          </div>
        </div>
      )}

      <header className="hero">
        <img className="hero-logo" src="/icon.svg" alt="Codescape" width={80} height={80} />
        <h1 className="hero-title">Codescape</h1>
        <p className="hero-tagline">An explorable atlas of any codebase.</p>
        <p className="hero-overview">
          Upload a repository and Codescape maps it into a navigable system model — zoom from
          high-level capabilities down through files and functions to the source itself,
          like an atlas that goes from continents to streets.
        </p>
        <ul className="hero-chips">
          <li>🧩 Concept → File → Function</li>
          <li>🌐 3D &amp; 2D views</li>
          <li>◎ Source-linked</li>
          <li>✦ AI-named layers</li>
        </ul>
      </header>

      {error && <div className="landing-error" role="alert">{error}</div>}

      <div className="action-grid">
        {/* Upload card */}
        <section
          className={`action-card dropzone${dragOver ? " dragover" : ""}${uploading ? " busy" : ""}`}
          onDragOver={(e) => { e.preventDefault(); if (!uploading) setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files[0];
            if (file) handleFile(file);
          }}
        >
          {uploading ? (
            <div className="card-body center">
              <div className="spinner" aria-hidden="true" />
              <p className="card-title">Analyzing repository…</p>
              <p className="card-sub">Parsing files, building the graph, and mapping capabilities.</p>
            </div>
          ) : (
            <div className="card-body center">
              <div className="card-icon">⬆</div>
              <p className="card-title">Upload a .zip</p>
              <p className="card-sub">Drag &amp; drop a repository archive, or browse for one.</p>
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
              <button type="button" className="btn-primary" onClick={() => fileInputRef.current?.click()}>
                Choose file
              </button>
            </div>
          )}
        </section>

        {/* GitHub card */}
        <section className="action-card github-card">
          {githubConnection ? (
            <div className="card-body">
              <div className="card-head">
                <span className="card-title">Your GitHub repositories</span>
                <span className="badge-connected">● connected</span>
              </div>
              {githubLoading ? (
                <p className="card-sub">Loading repositories…</p>
              ) : githubRepos.length === 0 ? (
                <p className="card-sub">No repositories found for this account.</p>
              ) : (
                <ul className="gh-repo-list">
                  {githubRepos.map((r) => (
                    <li key={r.id} className="gh-repo" onClick={() => importSelectedGitHub(r)}>
                      <span className="gh-repo-name">{r.fullName}</span>
                      <span className="gh-repo-meta">{r.defaultBranch}{r.private ? " · private" : ""}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="card-body center">
              <div className="card-icon">⎇</div>
              <p className="card-title">Connect GitHub</p>
              <p className="card-sub">Import a public or private repository straight from your account.</p>
              <a className="btn-primary" href={githubConnectUrl}>Connect GitHub</a>
            </div>
          )}
        </section>
      </div>

      {repos.length > 0 && (
        <section className="recent-section">
          <h2 className="section-label">Previously analyzed</h2>
          <div className="recent-grid">
            {repos.map((r) => (
              <div
                key={r.id}
                className={`recent-card${r.status === "ready" ? "" : " not-ready"}`}
                role={r.status === "ready" ? "button" : undefined}
                tabIndex={r.status === "ready" ? 0 : undefined}
                onClick={() => r.status === "ready" && openRepo(r)}
                title={r.status === "ready" ? `Open ${r.name}` : r.status === "processing" ? "Still processing" : r.error ?? "Failed to analyze"}
              >
                <span className="recent-icon" data-origin={r.origin?.kind ?? "zip"}>{r.origin?.kind === "github" ? "⎇" : "⬆"}</span>
                <span className="recent-body">
                  <span className="recent-name">{r.name}</span>
                  <span className={`status-tag ${r.status}`}>{r.status}</span>
                </span>
                <span className="recent-actions">
                  {r.origin?.kind === "github" && r.status === "ready" && (
                    <button
                      type="button"
                      className="row-btn"
                      title={githubConnection ? "Re-fetch latest from GitHub (replaces in place)" : "Connect GitHub to re-import"}
                      onClick={(e) => { e.stopPropagation(); reimport(r); }}
                    >
                      ↻
                    </button>
                  )}
                  <button
                    type="button"
                    className="row-btn danger"
                    title="Delete this repository"
                    onClick={(e) => { e.stopPropagation(); removeRepo(r); }}
                  >
                    ✕
                  </button>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <footer className="landing-footer">
        <a href="https://github.com/Ntsinga/Codescape" target="_blank" rel="noreferrer">Codescape on GitHub</a>
      </footer>
    </div>
  );
}
