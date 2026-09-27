import type { NextFunction, Request, Response } from "express";
import { getAuth } from "@clerk/express";

export { getAuth };

/**
 * Rejects unauthenticated requests with JSON (not Clerk's default HTML/redirect
 * response) so every route under it can trust req.auth.userId is set. Relies on
 * clerkMiddleware() having already run (mounted once in server.ts) to populate
 * req.auth from either a session cookie or an `Authorization: Bearer <token>`
 * header — the latter is what the frontend uses for its cross-origin API calls.
 */
export function requireUser(req: Request, res: Response, next: NextFunction): void {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Sign in required" });
    return;
  }
  next();
}
