import fs from "node:fs";
import path from "node:path";
import yauzl from "yauzl";
import { isIgnoredDir, isIgnoredFile, limits } from "./ignoreRules.js";

export interface ExtractedFile {
  relativePath: string; // posix-style, relative to repo root
  absolutePath: string;
  size: number;
}

/**
 * Extracts a zip archive into destDir, refusing any entry whose resolved
 * path would escape destDir (zip-slip) and enforcing size/count limits.
 * Ignored directories/files are skipped entirely rather than written to disk.
 */
export function extractZip(zipPath: string, destDir: string): Promise<ExtractedFile[]> {
  return new Promise((resolve, reject) => {
    const files: ExtractedFile[] = [];
    let totalBytes = 0;
    let fileCount = 0;

    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(err ?? new Error("Failed to open zip"));

      zipfile.readEntry();

      zipfile.on("entry", (entry) => {
        const rawName = entry.fileName.replace(/\\/g, "/");
        const isDir = rawName.endsWith("/");

        // Reject absolute paths and traversal sequences outright.
        if (path.isAbsolute(rawName) || rawName.split("/").includes("..")) {
          zipfile.readEntry();
          return;
        }

        const segments = rawName.split("/").filter(Boolean);
        if (segments.some((seg: string) => isIgnoredDir(seg))) {
          zipfile.readEntry();
          return;
        }

        const destPath = path.resolve(destDir, ...segments);
        const relativeCheck = path.relative(destDir, destPath);
        if (relativeCheck.startsWith("..") || path.isAbsolute(relativeCheck)) {
          // zip-slip attempt
          zipfile.readEntry();
          return;
        }

        if (isDir) {
          fs.mkdirSync(destPath, { recursive: true });
          zipfile.readEntry();
          return;
        }

        const relPosix = segments.join("/");
        if (isIgnoredFile(relPosix)) {
          zipfile.readEntry();
          return;
        }

        fileCount += 1;
        if (fileCount > limits.MAX_FILE_COUNT) {
          zipfile.close();
          return reject(new Error(`Archive exceeds max file count (${limits.MAX_FILE_COUNT})`));
        }

        if (entry.uncompressedSize > limits.MAX_FILE_BYTES) {
          // Skip oversized individual files rather than aborting the whole upload.
          zipfile.readEntry();
          return;
        }

        totalBytes += entry.uncompressedSize;
        if (totalBytes > limits.MAX_TOTAL_BYTES) {
          zipfile.close();
          return reject(new Error(`Archive exceeds max total size (${limits.MAX_TOTAL_BYTES} bytes)`));
        }

        zipfile.openReadStream(entry, (streamErr, readStream) => {
          if (streamErr || !readStream) {
            zipfile.readEntry();
            return;
          }
          fs.mkdirSync(path.dirname(destPath), { recursive: true });
          const writeStream = fs.createWriteStream(destPath);
          readStream.pipe(writeStream);
          writeStream.on("finish", () => {
            files.push({ relativePath: relPosix, absolutePath: destPath, size: entry.uncompressedSize });
            zipfile.readEntry();
          });
          writeStream.on("error", () => zipfile.readEntry());
        });
      });

      zipfile.on("end", () => resolve(files));
      zipfile.on("error", (e) => reject(e));
    });
  });
}
