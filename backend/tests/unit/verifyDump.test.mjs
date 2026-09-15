// Unit tests for scripts/lib/verify-dump.mjs.
//
// This is the check standing between "a manifest says a backup was taken" and
// "a backup is there", immediately before a destructive migration. It needs no
// database, which matters: the gate it serves exempts local databases, so CI's
// Postgres can never exercise it and these tests are the only coverage it gets.

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import os from "node:os";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { verifyBackupFile } from "../../scripts/lib/verify-dump.mjs";

async function backupDirectory(contents = crypto.randomBytes(2048)) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fsr-verify-"));
  await writeFile(path.join(dir, "postgres-2026-09-15.dump.enc"), contents);
  const manifest = {
    file: "postgres-2026-09-15.dump.enc",
    bytes: contents.length,
    sha256: crypto.createHash("sha256").update(contents).digest("hex"),
  };
  return { dir, manifest, contents };
}

test("a dump that is there, the right size and the right hash passes", async () => {
  const { dir, manifest } = await backupDirectory();
  try {
    assert.equal(await verifyBackupFile(dir, manifest), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a manifest whose dump has been deleted is refused", async () => {
  const { dir, manifest } = await backupDirectory();
  try {
    await rm(path.join(dir, manifest.file));
    const problem = await verifyBackupFile(dir, manifest);
    assert.match(problem, /is not there/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a truncated dump is refused on its size", async () => {
  const { dir, manifest, contents } = await backupDirectory();
  try {
    await writeFile(path.join(dir, manifest.file), contents.subarray(0, 1000));
    const problem = await verifyBackupFile(dir, manifest);
    assert.match(problem, /is 1000 bytes, but the manifest records/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a dump of the right size but the wrong contents is refused on its hash", async () => {
  // The case a size check alone would miss: a file cut off and padded, or a
  // half-finished copy that happens to land on the same length.
  const { dir, manifest, contents } = await backupDirectory();
  try {
    const altered = Buffer.from(contents);
    altered[altered.length - 1] ^= 0xff;
    await writeFile(path.join(dir, manifest.file), altered);

    const problem = await verifyBackupFile(dir, manifest);
    assert.match(problem, /does not match the checksum/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a manifest naming no file is refused rather than passing by omission", async () => {
  const { dir } = await backupDirectory();
  try {
    assert.match(await verifyBackupFile(dir, {}), /does not name a dump/);
    assert.match(await verifyBackupFile(dir, null), /does not name a dump/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an older manifest without a checksum is still checked for existence and size", async () => {
  // Manifests written before the checksum existed should not be treated as
  // unverifiable and waved through, nor refused outright.
  const { dir, manifest, contents } = await backupDirectory();
  try {
    const legacy = { file: manifest.file, bytes: contents.length };
    assert.equal(await verifyBackupFile(dir, legacy), null);

    await rm(path.join(dir, manifest.file));
    assert.match(await verifyBackupFile(dir, legacy), /is not there/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
