import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id at OWASP's minimum recommended parameters. Native module, so this
 * file (and anything importing it) is Node-runtime only — it cannot run on
 * the edge.
 */
const OPTIONS = {
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, OPTIONS);
}

export async function verifyPassword(digest: string, plaintext: string): Promise<boolean> {
  try {
    return await verify(digest, plaintext, OPTIONS);
  } catch {
    // A malformed stored digest must read as "wrong password", never as a crash
    // that distinguishes this account from one with a valid hash.
    return false;
  }
}
