import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// AES-256-GCM for connector credentials at rest. The 32-byte key is derived
// from ENCRYPTION_KEY via SHA-256 so any sufficiently random env value works.
function deriveKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY ?? 'insecure-dev-key';
  return createHash('sha256').update(raw).digest();
}

/** Encrypt a string -> "iv:tag:ciphertext" (all base64). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

/** Decrypt an "iv:tag:ciphertext" value produced by encryptSecret. */
export function decryptSecret(enc: string): string {
  const [ivB, tagB, ctB] = enc.split(':');
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(), Buffer.from(ivB, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64')), decipher.final()]).toString('utf8');
}
