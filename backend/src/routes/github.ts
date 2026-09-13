import { Router } from "express";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { processRepoZip } from "../ingestion/processRepo.js";
import { uploadsTmpDir } from "../storage/paths.js";
import { getRepo } from "../graph/queries.js";

const githubRouter = Router();
const pending = new Map<string, { createdAt: number }>();
const sessions = new Map<string, { token: string; createdAt: number }>();
const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:5173";

function config() {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are required");
  return { clientId, clientSecret };
}

githubRouter.get("/github/connect", (req, res) => {
  try {
    const { clientId } = config();
    const state = crypto.randomBytes(24).toString("hex");
    pending.set(state, { createdAt: Date.now() });
    const callback = process.env.GITHUB_CALLBACK_URL ?? "http://localhost:4000/api/github/callback";
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", callback);
    // `repo` is required for importing private repositories the user explicitly authorizes.
    url.searchParams.set("scope", "repo read:org");
    url.searchParams.set("state", state);
    res.redirect(url.toString());
  } catch (err) { res.status(500).json({ error: err instanceof Error ? err.message : "GitHub OAuth is not configured" }); }
});

function failToApp(res: import("express").Response, message: string): void {
  // Always land the user back in the app with a readable message, never a raw error page.
  res.redirect(`${frontendUrl}/?github=error&message=${encodeURIComponent(message)}`);
}

githubRouter.get("/github/callback", async (req, res) => {
  const state = String(req.query.state ?? "");
  const record = pending.get(state);
  pending.delete(state);
  if (!record || Date.now() - record.createdAt > 10 * 60_000) {
    failToApp(res, "GitHub sign-in expired or was already used. Please click Connect GitHub again.");
    return;
  }
  if (req.query.error) {
    failToApp(res, `GitHub denied the request: ${String(req.query.error_description ?? req.query.error)}`);
    return;
  }
  try {
    const { clientId, clientSecret } = config();
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "Codescape" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code: req.query.code, redirect_uri: process.env.GITHUB_CALLBACK_URL ?? "http://localhost:4000/api/github/callback" }),
    });

    // GitHub returns JSON when Accept: application/json is honored, but error pages
    // (bad credentials, rate limiting, GitHub App vs OAuth App mismatch) can be HTML.
    const raw = await tokenRes.text();
    let token: { access_token?: string; error?: string; error_description?: string } = {};
    try {
      token = JSON.parse(raw);
    } catch {
      console.error(`[github] token endpoint returned non-JSON (status ${tokenRes.status}):`, raw.slice(0, 300));
      failToApp(res, `GitHub token exchange returned an unexpected response (HTTP ${tokenRes.status}). Check that GITHUB_CLIENT_ID/SECRET are for an OAuth App and the callback URL matches.`);
      return;
    }

    if (!token.access_token) {
      console.error("[github] token exchange error:", token);
      failToApp(res, token.error_description || token.error || "GitHub token exchange failed.");
      return;
    }

    const connection = crypto.randomBytes(18).toString("hex");
    sessions.set(connection, { token: token.access_token, createdAt: Date.now() });
    res.redirect(`${frontendUrl}/?github=connected&connection=${connection}`);
  } catch (err) {
    console.error("[github] callback error:", err);
    failToApp(res, err instanceof Error ? err.message : "GitHub authentication failed");
  }
});

function session(req: import("express").Request) { return sessions.get(String(req.query.connection ?? req.headers["x-github-connection"] ?? "")); }

githubRouter.get("/github/repos", async (req, res) => {
  const current = session(req);
  if (!current) { res.status(401).json({ error: "Connect GitHub first" }); return; }
  const response = await fetch("https://api.github.com/user/repos?sort=updated&per_page=100", { headers: { Authorization: `Bearer ${current.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } });
  if (!response.ok) { res.status(response.status).json({ error: "Unable to list GitHub repositories" }); return; }
  const repos = await response.json();
  res.json(repos.map((r: any) => ({ id: r.id, name: r.name, fullName: r.full_name, private: r.private, defaultBranch: r.default_branch, cloneUrl: r.clone_url })));
});

async function downloadZipball(token: string, owner: string, repo: string, branch: string | undefined): Promise<string> {
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/zipball/${encodeURIComponent(branch ?? "HEAD")}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } }
  );
  if (!response.ok || !response.body) throw new Error("Unable to download GitHub repository");
  const zipPath = path.join(uploadsTmpDir, `github-${crypto.randomBytes(8).toString("hex")}.zip`);
  await fs.writeFile(zipPath, Buffer.from(await response.arrayBuffer()));
  return zipPath;
}

githubRouter.post("/github/import", async (req, res) => {
  const current = session(req);
  if (!current) { res.status(401).json({ error: "Connect GitHub first" }); return; }
  const { owner, repo, branch } = req.body ?? {};
  if (!owner || !repo) { res.status(400).json({ error: "owner and repo are required" }); return; }
  try {
    const zipPath = await downloadZipball(current.token, owner, repo, branch);
    const result = await processRepoZip(zipPath, `${owner}/${repo}`, {
      origin: { kind: "github", owner, repo, branch: branch ?? "HEAD" },
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(422).json({ error: err instanceof Error ? err.message : "GitHub repository processing failed" });
  }
});

/** Re-fetch a previously imported GitHub repo into the SAME repo id (no duplicate). */
githubRouter.post("/github/reimport", async (req, res) => {
  const current = session(req);
  if (!current) { res.status(401).json({ error: "Connect GitHub first" }); return; }
  const repoId = String(req.body?.repoId ?? "");
  const record = getRepo(repoId);
  if (!record) { res.status(404).json({ error: "Repository not found" }); return; }
  if (record.origin.kind !== "github" || !record.origin.owner || !record.origin.repo) {
    res.status(400).json({ error: "This repository was not imported from GitHub" });
    return;
  }
  try {
    const { owner, repo, branch } = record.origin;
    const zipPath = await downloadZipball(current.token, owner, repo, branch ?? undefined);
    const result = await processRepoZip(zipPath, record.name, {
      repoId,
      origin: { kind: "github", owner, repo, branch: branch ?? "HEAD" },
    });
    res.status(200).json(result);
  } catch (err) {
    res.status(422).json({ error: err instanceof Error ? err.message : "GitHub re-import failed" });
  }
});

export { githubRouter };
