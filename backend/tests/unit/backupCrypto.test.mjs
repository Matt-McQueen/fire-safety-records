// Unit tests for scripts/lib/backup-crypto.mjs.
//
// A backup you cannot restore is not a backup, and encryption is the step most
// likely to turn one into the other silently. So: a round trip has to return
// the exact bytes, and every way of getting it wrong has to fail loudly rather
// than produce something that looks like a dump.

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import os from "node:os";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { decryptFile, encryptFile } from "../../scripts/lib/backup-crypto.mjs";

const PASSPHRASE = "correct-horse-battery-staple-42";

async function workspace() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fsr-backup-"));
  return {
    dir,
    file: (name) => path.join(dir, name),
    [Symbol.asyncDispose]: () => rm(dir, { recursive: true, force: true }),
  };
}

test("a dump survives a round trip byte for byte", async () => {
  const space = await workspace();
  try {
    // Larger than one stream chunk, so this exercises more than a single pass.
    const original = crypto.randomBytes(400_000);
    await writeFile(space.file("dump"), original);

    await encryptFile(space.file("dump"), space.file("dump.enc"), PASSPHRASE);
    await decryptFile(space.file("dump.enc"), space.file("restored"), PASSPHRASE);

    assert.ok(original.equals(await readFile(space.file("restored"))));
  } finally {
    await rm(space.dir, { recursive: true, force: true });
  }
});

test("the encrypted file does not contain the plaintext", async () => {
  const space = await workspace();
  try {
    await writeFile(space.file("dump"), "COPY people (full_name) FROM stdin;\nAisha Khan\n");
    await encryptFile(space.file("dump"), space.file("dump.enc"), PASSPHRASE);

    const encrypted = await readFile(space.file("dump.enc"));
    assert.ok(!encrypted.includes(Buffer.from("Aisha Khan")));
    assert.ok(!encrypted.includes(Buffer.from("COPY people")));
  } finally {
    await rm(space.dir, { recursive: true, force: true });
  }
});

test("the wrong passphrase fails rather than producing rubbish", async () => {
  const space = await workspace();
  try {
    await writeFile(space.file("dump"), "some dump contents");
    await encryptFile(space.file("dump"), space.file("dump.enc"), PASSPHRASE);

    await assert.rejects(
      () => decryptFile(space.file("dump.enc"), space.file("restored"), "a-different-passphrase"),
      /Could not decrypt the dump/,
    );
  } finally {
    await rm(space.dir, { recursive: true, force: true });
  }
});

test("an altered file fails to decrypt", async () => {
  const space = await workspace();
  try {
    await writeFile(space.file("dump"), crypto.randomBytes(5_000));
    await encryptFile(space.file("dump"), space.file("dump.enc"), PASSPHRASE);

    // Flip one byte in the middle of the ciphertext, the way a bad disk or a
    // truncated upload would.
    const encrypted = await readFile(space.file("dump.enc"));
    encrypted[Math.floor(encrypted.length / 2)] ^= 0xff;
    await writeFile(space.file("dump.enc"), encrypted);

    await assert.rejects(
      () => decryptFile(space.file("dump.enc"), space.file("restored"), PASSPHRASE),
      /Could not decrypt the dump/,
    );
  } finally {
    await rm(space.dir, { recursive: true, force: true });
  }
});

test("a file that is not one of ours is refused by name", async () => {
  const space = await workspace();
  try {
    await writeFile(space.file("plain.dump"), crypto.randomBytes(1_000));
    await assert.rejects(
      () => decryptFile(space.file("plain.dump"), space.file("restored"), PASSPHRASE),
      /not an encrypted dump/,
    );
  } finally {
    await rm(space.dir, { recursive: true, force: true });
  }
});

test("a short passphrase is refused before anything is written", async () => {
  const space = await workspace();
  try {
    await writeFile(space.file("dump"), "contents");
    await assert.rejects(
      () => encryptFile(space.file("dump"), space.file("dump.enc"), "short"),
      /at least 12 characters/,
    );
  } finally {
    await rm(space.dir, { recursive: true, force: true });
  }
});
