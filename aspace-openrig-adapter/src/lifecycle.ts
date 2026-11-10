/**
 * @aspace/openrig-adapter — unique-daemon lifecycle (D-N051 F8, pas 4, D5).
 *
 * REPLACES the openrig CLI lifecycle, which is NOT ported:
 * `packages/cli/src/daemon-auto-start.ts` (auto-start on CLI invocation),
 * `daemon-start-lock.ts` (start lock), `daemon-reachability.ts`
 * (probe), `daemon-lifecycle-status.ts` (status), `daemon-lifecycle.ts`
 * (state machine), `local-daemon-owner.ts` (ownership).
 *
 * In the A'Space runtime there is ONE daemon — the RigInfinity unique
 * daemon (pas 3 base). It owns the lifecycle: it starts once, it holds the
 * lock, it answers `/healthz` on loopback, and the CLI talks to it instead
 * of starting its own. This module is the contract the CLI uses against
 * the unique daemon: endpoint resolution, liveness probe, PID lock, and the
 * TUI re-pointing (D3 — the TUI connects to the unique daemon, not to the
 * openrig daemon that no longer runs).
 *
 * The openrig daemon's own record format (`daemon.json`: pid, port, db,
 * startedAt — `daemon-lifecycle.ts`) is NOT reused: the unique daemon
 * keeps its own record. Only the shape of the probe (loopback `/healthz`,
 * 500 ms timeout — `daemon-db-path.ts:126`) is carried over.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Default liveness-probe timeout, as the daemon uses it (500 ms). */
export const DAEMON_PROBE_TIMEOUT_MS = 500;

/** The unique daemon's endpoint: loopback only, never a LAN address. */
export interface UniqueDaemonEndpoint {
  host: "127.0.0.1";
  port: number;
  baseUrl: string;
}

/**
 * Resolve the unique daemon's HTTP endpoint. The port is a parameter —
 * the adapter invents no port number: the caller passes the port the
 * unique daemon actually listens on (its record, its config).
 */
export function resolveUniqueDaemonEndpoint(port: number): UniqueDaemonEndpoint {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`invalid unique-daemon port ${JSON.stringify(port)} — must be 1..65535`);
  }
  return { host: "127.0.0.1", port, baseUrl: `http://127.0.0.1:${port}` };
}

/** The TUI endpoint: the TUI re-points here (D3), never at the openrig daemon. */
export function resolveTuiEndpoint(uniqueDaemon: UniqueDaemonEndpoint): string {
  return uniqueDaemon.baseUrl;
}

export interface DaemonProbeResult {
  /** The daemon answered /healthz with a pid. */
  alive: boolean;
  /** The pid the daemon reports, when it answered. */
  pid?: number;
  /** Why the probe did not get an answer (refused = down; timeout = wedged). */
  reason?: "refused" | "timeout" | "unreadable" | "wrong-pid";
}

/**
 * Probe the unique daemon's liveness on loopback `/healthz` (500 ms).
 * `expectedPid` — when given, the answering pid must match it, or the
 * result is `wrong-pid` (the daemon-db-path rule: a listener that names
 * another pid is not our daemon). Never asserts "down" on a timeout:
 * a timeout is a wedged loop, not a stopped daemon (daemon-lifecycle.ts,
 * ruling 1ae863d2 — 3-state semantics).
 */
export async function probeDaemon(
  endpoint: UniqueDaemonEndpoint,
  expectedPid?: number,
): Promise<DaemonProbeResult> {
  let response: Response;
  try {
    response = await fetch(`${endpoint.baseUrl}/healthz`, {
      signal: AbortSignal.timeout(DAEMON_PROBE_TIMEOUT_MS),
    });
  } catch (error) {
    const name = (error as { name?: unknown }).name;
    if (name === "TimeoutError") return { alive: false, reason: "timeout" };
    return { alive: false, reason: "refused" };
  }
  if (!response.ok) return { alive: false, reason: "unreadable" };
  let body: { pid?: unknown };
  try {
    body = (await response.json()) as { pid?: unknown };
  } catch {
    return { alive: false, reason: "unreadable" };
  }
  if (typeof body.pid !== "number") return { alive: false, reason: "unreadable" };
  if (expectedPid !== undefined && body.pid !== expectedPid) {
    return { alive: false, reason: "wrong-pid", pid: body.pid };
  }
  return { alive: true, pid: body.pid };
}

/**
 * The start lock: one file, one daemon. The unique daemon holds
 * `<home>/daemon.pid` (exclusive create); a second starter that finds a
 * live pid in the file refuses to start. A stale file (pid not alive) is
 * replaced, never honoured. This is the replacement for
 * `daemon-start-lock.ts` — same rule, one daemon, no auto-start race.
 */
export function acquireDaemonLock(home: string): { pid: number; lockPath: string } {
  mkdirSync(home, { recursive: true });
  const lockPath = join(home, "daemon.pid");
  const pid = process.pid;
  if (existsSync(lockPath)) {
    const existing = readFileSync(lockPath, "utf8").trim();
    const existingPid = Number(existing);
    if (Number.isInteger(existingPid) && existingPid > 0 && existingPid !== pid) {
      try {
        process.kill(existingPid, 0);
        throw new Error(`unique daemon already running (pid ${existingPid}, lock ${lockPath}) — refusing a second daemon`);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("unique daemon already running")) throw error;
        // ESRCH: the pid is dead — the lock is stale, replace it.
      }
    }
  }
  writeFileSync(lockPath, `${pid}\n`, { flag: "w" });
  return { pid, lockPath };
}

/** Release the lock the current process holds (no-op when it is not ours). */
export function releaseDaemonLock(home: string): void {
  const lockPath = join(home, "daemon.pid");
  if (!existsSync(lockPath)) return;
  const existing = readFileSync(lockPath, "utf8").trim();
  if (Number(existing) === process.pid) rmSync(lockPath);
}
