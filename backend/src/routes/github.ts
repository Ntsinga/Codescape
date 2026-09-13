import { Router } from "express";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { processRepoZip } from "../ingestion/processRepo.js";
import { uploadsTmpDir } from "../storage/paths.js";

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

githubRouter.get("/github/callback", async (req, res) => {
  const state = String(req.query.state ?? "");
  const record = pending.get(state);
  pending.delete(state);
  if (!record || Date.now() - record.createdAt > 10 * 60_000) { res.status(400).send("Invalid or expired GitHub OAuth state"); return; }
  try {
    const { clientId, clientSecret } = config();
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code: req.query.code }) });
    const token = (await tokenRes.json()) as { access_token?: string; error?: string };
    if (!token.access_token) throw new Error(token.error ?? "GitHub token exchange failed");
    const connection = crypto.randomBytes(18).toString("hex");
    sessions.set(connection, { token: token.access_token, createdAt: Date.now() });
    res.redirect(`${frontendUrl}/?github=connected&connection=${connection}`);
  } catch (err) { res.status(502).send(err instanceof Error ? err.message : "GitHub authentication failed"); }
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

githubRouter.post("/github/import", async (req, res) => {
  const current = session(req);
  if (!current) { res.status(401).json({ error: "Connect GitHub first" }); return; }
  const { owner, repo, branch } = req.body ?? {};
  if (!owner || !repo) { res.status(400).json({ error: "owner and repo are required" }); return; }
  const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/zipball/${encodeURIComponent(branch ?? "HEAD")}`, { headers: { Authorization: `Bearer ${current.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } });
  if (!response.ok || !response.body) { res.status(response.status || 502).json({ error: "Unable to download GitHub repository" }); return; }
  const zipPath = path.join(uploadsTmpDir, `github-${crypto.randomBytes(8).toString("hex")}.zip`);
  await fs.writeFile(zipPath, Buffer.from(await response.arrayBuffer()));
  try { res.status(201).json(await processRepoZip(zipPath, `${owner}/${repo}`)); }
  catch (err) { res.status(422).json({ error: err instanceof Error ? err.message : "GitHub repository processing failed" }); }
});

export { githubRouter };
