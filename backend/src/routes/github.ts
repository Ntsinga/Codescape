import { Router } from "express";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { processRepoZip } from "../ingestion/processRepo.js";
import { uploadsTmpDir } from "../storage/paths.js";
import { getRepoForUser, savePendingOAuthState, consumePendingOAuthState, saveGithubSession, getGithubSessionToken } from "../graph/queries.js";
import { requireUser, getAuth } from "../auth.js";
import { collectHistoryInBackground } from "../graph/history.js";

const githubRouter = Router();
const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:5173";

function config() {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are required");
  return { clientId, clientSecret };
}

/**
 * Starts GitHub OAuth. Called with fetch (so the Clerk session travels in the
 * Authorization header like every other API call) and returns the GitHub
 * authorize URL; the browser then navigates straight to github.com. The CSRF
 * `state` carries the userId through to /github/callback, which GitHub hits
 * with no auth of its own. No session token ever appears in a URL.
 */
githubRouter.post("/github/connect-url", requireUser, async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const { clientId } = config();
    const state = crypto.randomBytes(24).toString("hex");
    await savePendingOAuthState(state, userId!);
    const callback = process.env.GITHUB_CALLBACK_URL ?? "http://localhost:4000/api/github/callback";
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", callback);
    // `repo` is required for importing private repositories the user explicitly authorizes.
    url.searchParams.set("scope", "repo read:org");
    url.searchParams.set("state", state);
    res.json({ url: url.toString() });
  } catch (err) { res.status(500).json({ error: err instanceof Error ? err.message : "GitHub OAuth is not configured" }); }
});

function failToApp(res: import("express").Response, message: string): void {
  // Always land the user back in the app with a readable message, never a raw error page.
  res.redirect(`${frontendUrl}/?github=error&message=${encodeURIComponent(message)}`);
}

githubRouter.get("/github/callback", async (req, res) => {
  const state = String(req.query.state ?? "");
  const pending = await consumePendingOAuthState(state);
  if (!pending || Date.now() - pending.createdAt.getTime() > 10 * 60_000) {
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

    await saveGithubSession(pending.userId, token.access_token);
    res.redirect(`${frontendUrl}/?github=connected`);
  } catch (err) {
    console.error("[github] callback error:", err);
    failToApp(res, err instanceof Error ? err.message : "GitHub authentication failed");
  }
});

githubRouter.get("/github/repos", requireUser, async (req, res) => {
  const { userId } = getAuth(req);
  const token = await getGithubSessionToken(userId!);
  if (!token) { res.status(401).json({ error: "Connect GitHub first" }); return; }
  const response = await fetch("https://api.github.com/user/repos?sort=updated&per_page=100", { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } });
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
  // Stream to disk rather than buffering the whole archive in memory — a large
  // zipball would otherwise spike RAM and OOM-kill the (512MB) instance.
  await pipeline(Readable.fromWeb(response.body as any), createWriteStream(zipPath));
  return zipPath;
}

githubRouter.post("/github/import", requireUser, async (req, res) => {
  const { userId } = getAuth(req);
  const token = await getGithubSessionToken(userId!);
  if (!token) { res.status(401).json({ error: "Connect GitHub first" }); return; }
  const { owner, repo, branch } = req.body ?? {};
  if (!owner || !repo) { res.status(400).json({ error: "owner and repo are required" }); return; }
  try {
    const zipPath = await downloadZipball(token, owner, repo, branch);
    const result = await processRepoZip(zipPath, `${owner}/${repo}`, {
      origin: { kind: "github", owner, repo, branch: branch ?? "HEAD" },
      userId: userId!,
    });
    collectHistoryInBackground(result.repoId, owner, repo, branch ?? null, token);
    res.status(201).json(result);
  } catch (err) {
    res.status(422).json({ error: err instanceof Error ? err.message : "GitHub repository processing failed" });
  }
});

/** Re-fetch a previously imported GitHub repo into the SAME repo id (no duplicate). */
githubRouter.post("/github/reimport", requireUser, async (req, res) => {
  const { userId } = getAuth(req);
  const token = await getGithubSessionToken(userId!);
  if (!token) { res.status(401).json({ error: "Connect GitHub first" }); return; }
  const repoId = String(req.body?.repoId ?? "");
  const record = await getRepoForUser(repoId, userId!);
  if (!record) { res.status(404).json({ error: "Repository not found" }); return; }
  if (record.origin.kind !== "github" || !record.origin.owner || !record.origin.repo) {
    res.status(400).json({ error: "This repository was not imported from GitHub" });
    return;
  }
  try {
    const { owner, repo, branch } = record.origin;
    const zipPath = await downloadZipball(token, owner, repo, branch ?? undefined);
    const result = await processRepoZip(zipPath, record.name, {
      repoId,
      origin: { kind: "github", owner, repo, branch: branch ?? "HEAD" },
    });
    collectHistoryInBackground(repoId, owner, repo, branch ?? null, token);
    res.status(200).json(result);
  } catch (err) {
    res.status(422).json({ error: err instanceof Error ? err.message : "GitHub re-import failed" });
  }
});

/** (Re)collect git history for the 3D timeline without re-importing the code. */
githubRouter.post("/github/history", requireUser, async (req, res) => {
  const { userId } = getAuth(req);
  const token = await getGithubSessionToken(userId!);
  if (!token) { res.status(401).json({ error: "Connect GitHub first" }); return; }
  const record = await getRepoForUser(String(req.body?.repoId ?? ""), userId!);
  if (!record) { res.status(404).json({ error: "Repository not found" }); return; }
  if (record.origin.kind !== "github" || !record.origin.owner || !record.origin.repo) {
    res.status(400).json({ error: "Only GitHub imports have history — a zip upload is a single snapshot." });
    return;
  }
  collectHistoryInBackground(record.id, record.origin.owner, record.origin.repo, record.origin.branch, token);
  res.status(202).json({ ok: true });
});

export { githubRouter };
