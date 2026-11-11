/**
 * @aspace/openrig-adapter — the only A'Space code in this fork (D-N051 F8, pas 4).
 *
 * The upstream OpenRig runtime is never modified (byte-identical to the
 * frozen commit). Every A'Space adaptation lives here, behind this stable
 * surface. The adapter does NOT boot the runtime and does NOT wrap
 * inference: its job is the H-P4 contract — the daemon surface pinned on
 * the gel (D2), the ULID lineage scheduler that replaces the bind's
 * `Date.now()` spawner (D6), the unique-daemon lifecycle that replaces the
 * CLI lifecycle (D5), the localhost-only bind (D9), the NOOP telemetry
 * contract (D9) — plus pinning the exact upstream surface it depends on,
 * so a drift is a named design event, not a silent break.
 *
 * Pinned surface (upstream code this adapter depends on, gel bd39da9, 0.7.1):
 * - Rig / Pod / Node / Edge / Binding / Session from
 *   `packages/daemon/src/domain/types.ts` (see `rig.ts`).
 * - Herdr socket transport (`packages/daemon/src/domain/terminal/`,
 *   NDJSON `{id,method,params}` over `~/.config/herdr/herdr.sock`).
 * - `resolveDaemonDbPath()` — `<OPENRIG_HOME>/openrig.sqlite`
 *   (`packages/daemon/src/daemon-db-path.ts`).
 * - `resolveBindPlan()` — default `[127.0.0.1]` (+ tailscale IP when
 *   present); explicit `OPENRIG_BIND_HOST`
 *   (`packages/daemon/src/domain/bind-plan.ts`).
 * - `ATOM_TAXONOMIES = world | lore | skills | mission`
 *   (`packages/daemon/src/domain/context-packs/context-pack-types.ts`).
 * - Telemetry read surface `/api/telemetry/*` over local SQLite
 *   (`packages/daemon/src/routes/telemetry.ts`) — local only, no exporter.
 * - CLI lifecycle (`packages/cli/src/daemon-*.ts`) — REPLACED, not ported.
 * - Hono server (`packages/daemon/src/server.ts`, `routes/`) — NOT ported;
 *   routes are re-implemented in Rust (D4 OUT).
 * - `spawnHolonRig()` from the bind (`src/lineage_spawner.ts`, pin
 *   adafb0d) — declaration only; REPLACED by the ULID lineage scheduler.
 *
 * Version drift (D7): the gel is 0.7.1. The docs cite 0.7.5 / 0.7.8
 * (the pin's parent, 781b5fb, teaches what 0.7.8 added) — the docs are
 * ahead of the frozen code. The gel and the tags are not the same.
 *
 * Telemetry contract (H-P4, see `openrig-TELEMETRY-AUDIT.md`):
 * - Zero telemetry SDKs in the dependency tree.
 * - `packages/daemon/src/routes/telemetry.ts` is a LOCAL read projection
 *   over the daemon SQLite (usage_samples) — facts only, no account
 *   identity, no exporter.
 * - The adapter enforces the contract at runtime: `installOutboundGuard()`
 *   wraps the global `fetch` and denies every non-loopback host unless it
 *   is explicitly allow-listed for this run; known telemetry/analytics
 *   hosts are denied even when allow-listed.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export { RIG_ROLES, RIG_RUNTIMES } from "./rig.ts";
export type { Rig, Pod, RigNode, RigEdge, RigBinding, RigSession, ParsedRigSpec, RigSpecValidation } from "./rig.ts";
export { validateRigSpec } from "./rig.ts";
export { generateUlid, isUlid, LineageScheduler } from "./lineage.ts";export {
  HERDR_SOCKET_METHODS,
  HERDR_DEFAULT_SOCKET,
  resolveHerdrSocketPath,
  DirectHcCallError,
  assertNoDirectHcCall,
  findOrphanSessions,
  verifyNoOrphanSessions,
} from "./herdr.ts";
export type { HerdrSocketMethod, HerdrPane } from "./herdr.ts";
export {
  DAEMON_PROBE_TIMEOUT_MS,
  resolveUniqueDaemonEndpoint,
  resolveTuiEndpoint,
  probeDaemon,
  acquireDaemonLock,
  releaseDaemonLock,
} from "./lifecycle.ts";
export type { UniqueDaemonEndpoint, DaemonProbeResult } from "./lifecycle.ts";
export {
  ASPACE_TELEMETRY_CONTRACT,
  TELEMETRY_BLOCKLIST,
  DAEMON_OUTBOUND_SITES,
  TELEMETRY_ROUTES,
  AspaceOutboundBlockedError,
  isOutboundAllowed,
  installOutboundGuard,
} from "./telemetry.ts";
export { resolveAspaceBind, isLoopbackOnly, assertLoopbackOnly } from "./bind.ts";
export type { AspaceBindPlan } from "./bind.ts";
export {
  ATOM_TAXONOMIES,
  TAXONOMY_TEACHING,
  validateContextPackManifest,
  resolveContextPackRoot,
} from "./context-packs.ts";
export type { AtomTaxonomy, ContextPackManifest, ContextPackManifestFile, ContextPackValidation } from "./context-packs.ts";

/** Adapter version (semver of the adapted module, D4). */
export const ADAPTER_VERSION = "0.1.0";

/** Frozen upstream commit this adapter is built against, short form (D1). */
export const PINNED_OPENRIG_COMMIT = "bd39da9";

/** Frozen upstream commit, full 40-hex SHA (D1). */
export const PINNED_OPENRIG_COMMIT_FULL = "bd39da9872afc39cbe0c8e839a322b4cb8955cbe";

/** Frozen upstream version (D1 — the gel is 0.7.1, not 0.7.5 / 0.7.8). */
export const PINNED_OPENRIG_VERSION = "0.7.1";

/** Upstream repository this fork tracks. */
export const PINNED_UPSTREAM_REPO = "mvschwarz/openrig";

/** This fork. */
export const PINNED_FORK_REPO = "Amdkn/openrig";

/**
 * Version drift (D7): the gel is 0.7.1; the docs cite 0.7.5 / 0.7.8.
 * The pin's parent (781b5fb) teaches what 0.7.8 added — the docs are ahead
 * of the frozen code. Never claim 0.7.5 / 0.7.8 compatibility for the gel.
 */
export const VERSION_DRIFT = {
  gel: "0.7.1",
  docsCite: ["0.7.5", "0.7.8"],
  note: "docs are ahead of the frozen code; the gel and the tags are not the same",
} as const;

/** The pinned upstream surface, as names — a drift here is a design event. */
export const PINNED_SURFACE = [
  "Rig { id, name, createdAt, updatedAt } from packages/daemon/src/domain/types.ts:3",
  "Pod { id, rigId, namespace, label, summary, continuityPolicyJson, createdAt } from packages/daemon/src/domain/types.ts:10",
  "Node (seat) { id, rigId, logicalId, role, runtime, model, cwd, workspace, podId, agentRef, profile, label, ... } from packages/daemon/src/domain/types.ts:29",
  "Edge { id, rigId, sourceId, targetId, targetRef?, kind, createdAt } from packages/daemon/src/domain/types.ts:75",
  "Binding { id, nodeId, attachmentType: tmux|external_cli, tmuxSession, tmuxWindow, tmuxPane, cmuxWorkspace, cmuxSurface, updatedAt } from packages/daemon/src/domain/types.ts:84",
  "Session { id, nodeId, sessionName, status, resumeType, resumeToken, restorePolicy, origin, startupStatus, ... } from packages/daemon/src/domain/types.ts:100",
  "Herdr socket transport: NDJSON {id,method,params} -> {id,result} over ~/.config/herdr/herdr.sock (HERDR_SOCKET_PATH / HERDR_SESSION) — packages/daemon/src/domain/terminal/herdr-transport.ts",
  "Herdr methods: ping, pane.list, pane.report_agent_session, workspace.list, workspace.create, layout.apply, tab.focus, tab.close — packages/daemon/src/domain/terminal/herdr-adapter.ts",
  "resolveDaemonDbPath() — <OPENRIG_HOME>/openrig.sqlite, OPENRIG_DB / RIGGED_DB override, containment-checked — packages/daemon/src/daemon-db-path.ts",
  "resolveBindPlan() — default [127.0.0.1] (+ tailscale IP when present); explicit OPENRIG_BIND_HOST — packages/daemon/src/domain/bind-plan.ts",
  "ATOM_TAXONOMIES = world | lore | skills | mission — packages/daemon/src/domain/context-packs/context-pack-types.ts",
  "Context pack = directory with manifest.yaml + md/yaml/txt; storage <context.root>/<ref>/ (default $OPENRIG_HOME/context); NO new SQLite tables — packages/daemon/src/domain/context-packs/context-pack-types.ts",
  "Telemetry read surface (LOCAL, SQLite-backed): /api/telemetry/v1/events, /v1/queue-transitions, /v1/nodes/:nodeId/tenures, /usage/series, /usage/cost, /usage/top — packages/daemon/src/routes/telemetry.ts",
  "CLI lifecycle: daemon-auto-start.ts, daemon-lifecycle.ts, daemon-lifecycle-status.ts, daemon-reachability.ts, daemon-start-lock.ts, local-daemon-owner.ts — packages/cli/src/ (REPLACED by the unique daemon, not ported)",
  "Hono server (server.ts, routes/) — NOT ported; routes are re-implemented in Rust (D4 OUT)",
  "spawnHolonRig() from src/lineage_spawner.ts (bind adafb0d) — declaration only (Date.now() uniqueness, no I/O); REPLACED by the ULID lineage scheduler",
];

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** The frozen repo state: branch, HEAD short + full, HEAD message. */
export function getFrozenRepoInfo(repoRoot: string): {
  branch: string;
  headHash: string;
  headFull: string;
  headMessage: string;
} {
  return {
    branch: git(["rev-parse", "--abbrev-ref", "HEAD"], repoRoot),
    headHash: git(["rev-parse", "--short=7", "HEAD"], repoRoot),
    headFull: git(["rev-parse", "HEAD"], repoRoot),
    headMessage: git(["log", "-1", "--format=%s"], repoRoot),
  };
}

/** Is the working tree's HEAD the frozen commit? (Pre-commit semantic:
 *  true only before the adapter commit is made. After the commit, use
 *  `verifyAdapterCommit`.) */
export function verifyFrozenCommit(repoRoot: string): { ok: boolean; head: string } {
  const head = git(["rev-parse", "HEAD"], repoRoot);
  return { ok: head === PINNED_OPENRIG_COMMIT_FULL, head };
}

/**
 * Post-commit semantic: HEAD is the adapter commit line (1 or more commits
 * ahead of the gel) and the FIRST commit after the gel has the gel as its
 * parent. The adapter line never rebases onto a later upstream commit and
 * never merges — the gel stays the base, whatever the number of adapter
 * commits.
 */
export function verifyAdapterCommit(repoRoot: string): {
  ok: boolean;
  head: string;
  headFull: string;
  firstParentIsGel: boolean;
  ahead: number;
} {
  const headFull = git(["rev-parse", "HEAD"], repoRoot);
  const head = headFull.slice(0, 7);
  const ahead = Number(git(["rev-list", "--count", `${PINNED_OPENRIG_COMMIT_FULL}..HEAD`], repoRoot) || "0");
  let firstParentIsGel = false;
  try {
    const first = git(["rev-list", "--reverse", `${PINNED_OPENRIG_COMMIT_FULL}..HEAD`], repoRoot).split("\n")[0]?.trim() ?? "";
    if (first.length > 0) {
      const parent = git(["rev-parse", `${first}~1`], repoRoot);
      firstParentIsGel = parent === PINNED_OPENRIG_COMMIT_FULL;
    }
  } catch {
    firstParentIsGel = false;
  }
  return { ok: ahead >= 1 && firstParentIsGel, head, headFull, firstParentIsGel, ahead };
}

/**
 * Is the frozen commit an ancestor of HEAD, and what changed since it?
 * `nonAdapterFiles` lists every file changed since the gel that is NOT
 * inside `aspace-openrig-adapter/` — it must be empty: the adapter is the
 * only A'Space code in this fork (H-M2).
 */
export function verifyFrozenLineage(repoRoot: string): {
  ok: boolean;
  head: string;
  headFull: string;
  gelAncestor: boolean;
  ahead: number;
  nonAdapterFiles: string[];
} {
  const headFull = git(["rev-parse", "HEAD"], repoRoot);
  const head = headFull.slice(0, 7);
  let gelAncestor = false;
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", PINNED_OPENRIG_COMMIT_FULL, "HEAD"], { cwd: repoRoot });
    gelAncestor = true;
  } catch {
    gelAncestor = false;
  }
  const ahead = Number(git(["rev-list", "--count", `${PINNED_OPENRIG_COMMIT_FULL}..HEAD`], repoRoot) || "0");
  const changed = git(["diff", "--name-only", PINNED_OPENRIG_COMMIT_FULL, "HEAD"], repoRoot);
  const nonAdapterFiles = changed
    .split("\n")
    .map((f) => f.trim())
    .filter((f) => f.length > 0 && !f.startsWith("aspace-openrig-adapter/"));
  return { ok: gelAncestor && nonAdapterFiles.length === 0, head, headFull, gelAncestor, ahead, nonAdapterFiles };
}

/** Read and parse this adapter's contract.json (for the smoke + tooling). */
export function readContract(adapterDir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(`${adapterDir}/contract.json`, "utf8")) as Record<string, unknown>;
}
