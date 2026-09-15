// Checks that the dump a manifest describes is actually there, and is actually
// the file the manifest describes.
//
// The migration runner used to take a manifest at its word: a JSON file in the
// backup directory, naming the right database, recent enough. That is a record
// that a backup was taken, not evidence that one exists now. Delete the dump
// and leave the manifest behind — or copy a manifest to a new machine without
// the 300MB beside it — and the gate would wave a destructive migration
// through on the strength of a note saying everything was fine.
//
// So: the file is there, it is the size recorded for it, and it hashes to the
// checksum recorded for it. The hash is the slow part and it is the point —
// a truncated or half-copied dump has the right name and the wrong contents,
// which is exactly the failure a size check alone would miss on a file that
// was cut off at a block boundary.
//
// Returns null when the dump checks out, or a sentence saying what is wrong
// with it, suitable for showing to whoever is about to run the migration.

import crypto from "node:crypto";
import path from "node:path";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

export async function verifyBackupFile(backupDir, manifest) {
  if (!manifest?.file) return "the manifest does not name a dump file";

  const dumpPath = path.join(backupDir, manifest.file);

  let size;
  try {
    ({ size } = await stat(dumpPath));
  } catch {
    return `the dump it names (${manifest.file}) is not there`;
  }

  if (typeof manifest.bytes === "number" && size !== manifest.bytes) {
    return `${manifest.file} is ${size} bytes, but the manifest records ${manifest.bytes}`;
  }

  if (typeof manifest.sha256 === "string" && manifest.sha256.length === 64) {
    const actual = await sha256(dumpPath);
    if (actual !== manifest.sha256) {
      return `${manifest.file} does not match the checksum recorded for it`;
    }
  }

  return null;
}

async function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}
