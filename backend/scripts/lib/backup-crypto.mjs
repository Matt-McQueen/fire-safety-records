// Encryption for database dumps.
//
// A dump of this database is a copy of everything the API spends its time
// protecting: names, job titles, who was recorded as at risk and why. Under
// UK GDPR Art.9 some of that is special category data — fra_persons_at_risk
// can record that someone is at risk by reason of disability. A dump is
// therefore not a build artifact to be left in a downloads folder; it is the
// same personal data with none of the access control around it.
//
// AES-256-GCM with a scrypt-derived key, streamed so the file size does not
// have to fit in memory. GCM authenticates as well as encrypts, so a dump that
// has been altered or truncated fails to decrypt rather than restoring
// something subtly wrong.
//
// The trade this makes: lose the passphrase and the backup is gone. That is
// the correct trade for this data, and it is why backup.mjs says so loudly the
// first time it encrypts anything.

import crypto from "node:crypto";
import { once } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);

const MAGIC = Buffer.from("FSRBAK1\0", "utf8"); // 8 bytes, version included
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const HEADER_LENGTH = MAGIC.length + SALT_LENGTH + IV_LENGTH;

// Matches the cost the application uses for passwords. A backup passphrase is
// typed rarely and by a person, so the same memory-hard derivation applies.
const KDF = { N: 32768, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };

async function deriveKey(passphrase, salt) {
  if (!passphrase || passphrase.length < 12) {
    throw new Error("The backup passphrase must be at least 12 characters.");
  }
  return scrypt(passphrase.normalize("NFKC"), salt, 32, KDF);
}

async function write(stream, chunk) {
  if (!stream.write(chunk)) await once(stream, "drain");
}

export async function encryptFile(sourcePath, destinationPath, passphrase) {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = await deriveKey(passphrase, salt);

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const destination = createWriteStream(destinationPath);

  await write(destination, Buffer.concat([MAGIC, salt, iv]));

  createReadStream(sourcePath).pipe(cipher);
  for await (const chunk of cipher) {
    await write(destination, chunk);
  }

  // Only available once the cipher has seen everything, which is why it goes
  // at the end of the file rather than in the header.
  await write(destination, cipher.getAuthTag());
  await new Promise((resolve, reject) => destination.end((error) => (error ? reject(error) : resolve())));
}

export async function decryptFile(sourcePath, destinationPath, passphrase) {
  const { size } = await stat(sourcePath);
  if (size < HEADER_LENGTH + TAG_LENGTH) {
    throw new Error(`${sourcePath} is too small to be an encrypted dump.`);
  }

  const header = await readRange(sourcePath, 0, HEADER_LENGTH - 1);
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error(`${sourcePath} is not an encrypted dump written by backup.mjs.`);
  }

  const salt = header.subarray(MAGIC.length, MAGIC.length + SALT_LENGTH);
  const iv = header.subarray(MAGIC.length + SALT_LENGTH);
  const tag = await readRange(sourcePath, size - TAG_LENGTH, size - 1);
  const key = await deriveKey(passphrase, salt);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  const destination = createWriteStream(destinationPath);
  createReadStream(sourcePath, { start: HEADER_LENGTH, end: size - TAG_LENGTH - 1 }).pipe(decipher);

  try {
    for await (const chunk of decipher) {
      await write(destination, chunk);
    }
  } catch (error) {
    // GCM reports a wrong passphrase and a tampered file the same way, which
    // is the point: neither produces plausible output.
    destination.destroy();
    throw new Error(
      "Could not decrypt the dump: the passphrase is wrong, or the file has been altered or truncated.",
      { cause: error },
    );
  }

  await new Promise((resolve, reject) => destination.end((error) => (error ? reject(error) : resolve())));
}

async function readRange(path, start, end) {
  const chunks = [];
  for await (const chunk of createReadStream(path, { start, end })) chunks.push(chunk);
  return Buffer.concat(chunks);
}
