/**
 * @aspace/openrig-adapter — lineage scheduler (D-N051 F8, pas 4, D6).
 *
 * REPLACES `spawnHolonRig()` from the bind (`src/lineage_spawner.ts`,
 * pin adafb0d): that function is a declaration, not a scheduler — it builds
 * `RIG-${areaCode}-${childHolon}-${Date.now()}` with no I/O, no uniqueness
 * guarantee beyond the millisecond, and no record of what it spawned.
 *
 * The replacement is a real scheduler: ULID rig ids (the same identifier
 * family the daemon itself uses — `ulid` in `packages/daemon`), monotonic
 * within the millisecond, with the worktree path derived from the id and a
 * spawn record the unique daemon persists (see the native
 * `openrig_lineage` module in RigInfinity).
 */

import { randomBytes } from "node:crypto";

/** Crockford base32 alphabet, as the `ulid` package uses it. */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Encode 6 bytes (48 bits) as the 10-char ULID time part. */
function encodeTime(nowMs: number): string {
  let value = nowMs;
  let out = "";
  for (let i = 0; i < 10; i++) {
    out = CROCKFORD[value % 32] + out;
    value = Math.floor(value / 32);
  }
  return out;
}

/** Encode 10 random bytes (80 bits) as the 16-char ULID random part. */
function encodeRandom(bytes: Buffer): string {
  let out = "";
  // 80 bits = 16 x 5-bit groups, read big-endian from the byte array.
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += CROCKFORD[(acc >> bits) & 31];
    }
  }
  return out;
}

function incrementRandom(bytes: Buffer): Buffer {
  const next = Buffer.from(bytes);
  for (let i = next.length - 1; i >= 0; i--) {
    next[i] = (next[i] + 1) & 0xff;
    if (next[i] !== 0) break;
  }
  return next;
}

let lastTimeMs = -1;
let lastRandom: Buffer | null = null;

/**
 * Generate a ULID (26 chars, Crockford base32, `01...`).
 * Monotonic: two ids generated in the same millisecond sort after each
 * other (the random part is incremented, as the `ulid` package does).
 * Injectable clock / randomness for tests.
 */
export function generateUlid(nowMs: number = Date.now(), random: Buffer = randomBytes(10)): string {
  let rand = random;
  if (nowMs === lastTimeMs && lastRandom !== null) {
    rand = incrementRandom(lastRandom);
  }
  lastTimeMs = nowMs;
  lastRandom = Buffer.from(rand);
  return encodeTime(nowMs) + encodeRandom(rand);
}

/** A ULID is 26 Crockford-base32 characters. */
export function isUlid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}

/**
 * The lineage scheduler: the real ordonnanceur that replaces the bind's
 * `spawnHolonRig()`. Same rig-id shape (`RIG-<area>-<holon>-<unique>`),
 * same worktree layout (`.worktrees/<rigId>`), but the unique suffix is a
 * ULID, not `Date.now()` — sortable, collision-proof within the ms, and
 * recorded in the spawn record the unique daemon persists.
 */
export class LineageScheduler {
  /**
   * Spawn a rig id for a child holon in an area.
   * `areaCode` and `childHolon` are the caller's words (e.g. `A0`, `clara`);
   * they are upper-cased and stripped of anything outside [A-Z0-9-].
   */
  spawnRigId(areaCode: string, childHolon: string): string {
    const clean = (s: string) => s.toUpperCase().replace(/[^A-Z0-9-]/g, "").replace(/-+/g, "-") || "X";
    return `RIG-${clean(areaCode)}-${clean(childHolon)}-${generateUlid()}`;
  }

  /** The worktree path for a spawned rig (same layout as the bind). */
  worktreePath(rigId: string): string {
    return `.worktrees/${rigId}`;
  }

  /** Parse a spawned rig id back into its parts; null when not ours. */
  parseRigId(rigId: string): { areaCode: string; childHolon: string; ulid: string } | null {
    const m = /^RIG-([A-Z0-9-]+)-([A-Z0-9-]+)-([0-9A-HJKMNP-TV-Z]{26})$/.exec(rigId);
    if (!m) return null;
    return { areaCode: m[1], childHolon: m[2], ulid: m[3] };
  }
}
