import { Router } from "express";
import multer from "multer";
import path from "node:path";
import { nanoid } from "nanoid";
import { uploadsTmpDir } from "../storage/paths.js";
import { processRepoZip } from "../ingestion/processRepo.js";
import { getAuth } from "../auth.js";

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsTmpDir,
    filename: (_req, file, cb) => cb(null, `${nanoid(10)}-${path.basename(file.originalname)}`),
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const isZip = file.mimetype === "application/zip" || file.originalname.toLowerCase().endsWith(".zip");
    if (isZip) cb(null, true);
    else cb(new Error("Only .zip archives are accepted"));
  },
});

export const uploadRouter = Router();

uploadRouter.post("/repos", upload.single("archive"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No archive uploaded (expected multipart field 'archive')" });
    return;
  }
  const displayName = (req.body?.name as string | undefined)?.trim() || path.basename(req.file.originalname, ".zip");
  const { userId } = getAuth(req);

  try {
    const result = await processRepoZip(req.file.path, displayName, { origin: { kind: "zip", owner: null, repo: null, branch: null }, userId: userId! });
    res.status(201).json(result);
  } catch (err) {
    res.status(422).json({ error: err instanceof Error ? err.message : "Failed to process repository" });
  }
});
