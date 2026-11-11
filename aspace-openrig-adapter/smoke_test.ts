/**
 * Smoke test for @aspace/openrig-adapter (D-N051 F8, pas 4).
 * Standalone, no test framework:
 *   node --experimental-strip-types aspace-openrig-adapter/smoke_test.ts
 * Exit 0 = all checks green; exit 1 = at least one check red (named).
 * Also runnable with the network namespace removed (`unshare -n ...`):
 * every check is local (git reads, file reads, pure functions, a loopback
 * stub server, a fetch guard that throws before any network is touched),
 * so the smoke passes with zero interfaces at all.
 * The rig-YAML check uses the workspace `yaml` package (a declared
 * dependency of @openrig/daemon) — run `npm ci` at the repo root first.
 */
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import {
  ADAPTER_VERSION,
  ASPACE_TELEMETRY_CONTRACT,
  ATOM_TAXONOMIES,
  AspaceOutboundBlockedError,
  DAEMON_OUTBOUND_SITES,
  HERDR_SOCKET_METHODS,
  LineageScheduler,
  PINNED_OPENRIG_COMMIT_FULL,
  PINNED_OPENRIG_VERSION,
  PINNED_SURFACE,
  TELEMETRY_ROUTES,
  acquireDaemonLock,
  assertLoopbackOnly,
  assertNoDirectHcCall,
  findOrphanSessions,
  generateUlid,
  getFrozenRepoInfo,
  installOutboundGuard,
  isLoopbackOnly,
  isOutboundAllowed,
  isUlid,
  probeDaemon,
  readContract,
  releaseDaemonLock,
  resolveAspaceBind,
  resolveContextPackRoot,
  resolveHerdrSocketPath,
  resolveTuiEndpoint,
  resolveUniqueDaemonEndpoint,
  validateContextPackManifest,
  validateRigSpec,
  verifyFrozenCommit,
  verifyAdapterCommit,
  verifyFrozenLineage,
} from "./src/index.ts";

const ADAPTER_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(ADAPTER_DIR);

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    console.log(`  PASS ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function throws(name: string, fn: () => unknown, detail = ""): void {
  try {
    fn();
    check(name, false, `expected a throw${detail ? ` — ${detail}` : ""}`);
  } catch {
    check(name, true);
  }
}

async function main(): Promise<void> {
  console.log("== frozen commit (H-M2) ==");
  const info = getFrozenRepoInfo(REPO_ROOT);
  check("branch is main", info.branch === "main", `branch=${info.branch}`);
  // Post-commit semantic: HEAD is the adapter commit (1 ahead of the gel)
  // and its parent IS the gel. (Before the commit, verifyFrozenCommit
  // asserts HEAD == gel; after it, this is the check that matters.)
  const adapter = verifyAdapterCommit(REPO_ROOT);
  check("HEAD is ahead of the gel (adapter commit line)", adapter.ahead >= 1, `ahead=${adapter.ahead}`);
  check("the first adapter commit's parent is the gel", adapter.firstParentIsGel, `HEAD=${adapter.headFull}`);
  check("verifyAdapterCommit ok", adapter.ok);
  const frozen = verifyFrozenCommit(REPO_ROOT);
  console.log(`  (verifyFrozenCommit: ${frozen.ok ? "HEAD is the gel (pre-commit state)" : "HEAD is the adapter commit, not the gel — expected post-commit"})`);
  const lineage = verifyFrozenLineage(REPO_ROOT);
  check("gel is an ancestor of HEAD", lineage.gelAncestor);
  check("no non-adapter file changed since the gel", lineage.nonAdapterFiles.length === 0, lineage.nonAdapterFiles.join(", "));
  console.log(`  (HEAD ${lineage.head}, ${lineage.ahead} commit(s) ahead of the gel — all inside the adapter)`);

  console.log("== contract ==");
  const contract = readContract(ADAPTER_DIR) as { id?: string; version?: string; upstream?: Record<string, string> };
  check("contract id is fiber:a0:openrig", contract.id === "fiber:a0:openrig");
  check("contract version matches adapter", contract.version === ADAPTER_VERSION);
  check("contract gel matches", contract.upstream?.frozen_commit_full === PINNED_OPENRIG_COMMIT_FULL);
  check("contract gel version is 0.7.1", contract.upstream?.version === PINNED_OPENRIG_VERSION);
  check("pinned surface is non-empty", PINNED_SURFACE.length >= 10, `${PINNED_SURFACE.length} entries`);

  console.log("== rig YAML (starter + code-review) ==");
  const starter = parseYaml(readFileSync(join(REPO_ROOT, "packages/daemon/specs/rigs/launch/starter/rig.yaml"), "utf8"));
  const vStarter = validateRigSpec(starter);
  check("starter rig.yaml validates", vStarter.errors.length === 0, vStarter.errors.join("; "));
  check("starter has 1 pod / 2 members / 1 edge", vStarter.pods === 1 && vStarter.members === 2 && vStarter.edges === 1, `${vStarter.pods}/${vStarter.members}/${vStarter.edges}`);
  const review = parseYaml(readFileSync(join(REPO_ROOT, "packages/daemon/specs/rigs/focused/code-review/rig.yaml"), "utf8"));
  const vReview = validateRigSpec(review);
  check("code-review rig.yaml validates (qualified pod.member edges)", vReview.errors.length === 0, vReview.errors.join("; "));
  check("code-review has 2 pods / 3 members / 2 edges", vReview.pods === 2 && vReview.members === 3 && vReview.edges === 2, `${vReview.pods}/${vReview.members}/${vReview.edges}`);
  const bad = validateRigSpec({
    pods: [
      {
        id: "p",
        members: [{ id: "m1", agent_ref: "local:x", runtime: "nope" }],
        edges: [{ kind: "delegates_to", from: "m1", to: "ghost" }],
      },
    ],
  });
  check("invalid spec is rejected (bad runtime, ghost edge)", bad.errors.length === 2, bad.errors.join("; "));
  const noRole = validateRigSpec({
    pods: [{ id: "p", members: [{ id: "m1", agent_ref: "local:x", runtime: "pi" }], edges: [] }],
  });
  check("a member without a role validates (role is daemon-set)", noRole.errors.length === 0, noRole.errors.join("; "));

  console.log("== lineage scheduler (D6 — replaces Date.now() spawner) ==");
  const scheduler = new LineageScheduler();
  const idA = scheduler.spawnRigId("A0", "clara");
  const idB = scheduler.spawnRigId("A0", "clara");
  check("two spawned rig ids differ", idA !== idB, `${idA} vs ${idB}`);
  const parsed = scheduler.parseRigId(idA);
  check("rig id parses back (area/holon/ulid)", parsed !== null && parsed.areaCode === "A0" && parsed.childHolon === "CLARA" && isUlid(parsed.ulid), idA);
  check("rig id suffix is a ULID, not a bare timestamp", isUlid(idA.split("-").pop() ?? ""), idA);
  check("worktree path is .worktrees/<rigId>", scheduler.worktreePath(idA) === `.worktrees/${idA}`);
  check("a non-rig id does not parse", scheduler.parseRigId("RIG-A0-CLARA-1234567890") === null);
  const ulidA = generateUlid();
  const ulidB = generateUlid();
  check("two ULIDs differ and sort", ulidA !== ulidB && ulidA < ulidB, `${ulidA} / ${ulidB}`);
  check("ULID is 26 Crockford chars", isUlid(ulidA) && ulidA.length === 26);

  console.log("== herdr (H-P4-3, H-P4-6) ==");
  check("8 Herdr socket methods pinned", HERDR_SOCKET_METHODS.length === 8, HERDR_SOCKET_METHODS.join(", "));
  check("default socket path", resolveHerdrSocketPath({}) === join(process.env.HOME ?? "", ".config", "herdr", "herdr.sock"));
  check("HERDR_SOCKET_PATH wins", resolveHerdrSocketPath({ HERDR_SOCKET_PATH: "/run/herdr.sock" }) === "/run/herdr.sock");
  throws("direct hc call is refused", () => assertNoDirectHcCall("hc layout apply --workspace w1"));
  throws("herdr CLI via path is refused", () => assertNoDirectHcCall("/usr/local/bin/herdr status"));
  check("a socket-side command passes the guard", (() => { assertNoDirectHcCall("node ./herdr-client.mjs"); return true; })());
  const orphans = findOrphanSessions(
    [
      { id: "pane-1", seat_id: "build" },
      { id: "pane-2", session: "sess-review" },
      { id: "pane-3", seat_id: "ghost" },
    ],
    [
      { nodeId: "build" },
      { nodeId: "review", sessionName: "sess-review" },
    ],
  );
  check("orphan detection finds exactly the unattached pane", orphans.length === 1 && orphans[0] === "pane-3", orphans.join(", "));
  check("zero orphans when every pane is attached", findOrphanSessions([{ id: "p1", seat_id: "build" }], [{ nodeId: "build" }]).length === 0);

  console.log("== unique-daemon lifecycle (D5) ==");
  const endpoint = resolveUniqueDaemonEndpoint(7433);
  check("endpoint is loopback-only", endpoint.host === "127.0.0.1" && endpoint.baseUrl === "http://127.0.0.1:7433");
  check("TUI endpoint is the unique daemon", resolveTuiEndpoint(endpoint) === "http://127.0.0.1:7433");
  throws("invalid port is refused", () => resolveUniqueDaemonEndpoint(0));
  // A stub daemon on loopback: the probe talks to a real HTTP listener.
  const stub = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ pid: process.pid }));
  });
  await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
  const stubPort = (stub.address() as { port: number }).port;
  const stubEndpoint = resolveUniqueDaemonEndpoint(stubPort);
  const probeOk = await probeDaemon(stubEndpoint, process.pid);
  check("probe answers on loopback /healthz", probeOk.alive && probeOk.pid === process.pid, JSON.stringify(probeOk));
  const probeWrong = await probeDaemon(stubEndpoint, process.pid + 1);
  check("probe refuses a listener naming another pid", !probeWrong.alive && probeWrong.reason === "wrong-pid", JSON.stringify(probeWrong));
  await new Promise<void>((resolve) => stub.close(() => resolve()));
  const probeDown = await probeDaemon(stubEndpoint);
  check("probe reports refused when nothing listens", !probeDown.alive && probeDown.reason === "refused", JSON.stringify(probeDown));
  const lockHome = mkdtempSync(join(tmpdir(), "openrig-adapter-smoke-"));
  try {
    const lock = acquireDaemonLock(lockHome);
    check("lock acquired (pid file)", lock.pid === process.pid && readFileSync(join(lockHome, "daemon.pid"), "utf8").trim() === String(process.pid));
    releaseDaemonLock(lockHome);
    check("lock released (pid file gone)", !existsSync(join(lockHome, "daemon.pid")));
  } finally {
    rmSync(lockHome, { recursive: true, force: true });
  }

  console.log("== telemetry guard (D9) ==");
  check("telemetry contract is noop / zero exporters", ASPACE_TELEMETRY_CONTRACT.context === "noop" && ASPACE_TELEMETRY_CONTRACT.exporters.length === 0);
  check("telemetry routes are the 6 local read routes", TELEMETRY_ROUTES.length === 6, TELEMETRY_ROUTES.join(", "));
  check("daemon outbound sites are the 3 gated ones", DAEMON_OUTBOUND_SITES.join(",") === "github.com,slack.com,openrouter.ai");
  check("loopback is allowed", isOutboundAllowed("http://127.0.0.1:7433/healthz"));
  check("localhost is allowed", isOutboundAllowed("http://localhost:7433/healthz"));
  check("github.com is denied by default (plugin-vendor gate)", !isOutboundAllowed("https://github.com/mvschwarz/openrig-plugins"));
  check("slack.com is denied by default (gateway gate)", !isOutboundAllowed("https://slack.com/api/chat.postMessage"));
  check("openrouter.ai is denied by default (charge gate)", !isOutboundAllowed("https://openrouter.ai/api/v1/generation?id=x"));
  check("posthog is denied even when allow-listed", !isOutboundAllowed("https://us.posthog.com/capture", ["us.posthog.com"]));
  check("an explicitly allow-listed host passes", isOutboundAllowed("https://example.invalid/x", ["example.invalid"]));
  const restore = installOutboundGuard();
  try {
    let blocked = false;
    try {
      await fetch("https://github.com/mvschwarz/openrig-plugins");
    } catch (error) {
      blocked = error instanceof AspaceOutboundBlockedError;
    }
    check("guard blocks the plugin-vendor fetch before any network", blocked);
  } finally {
    restore();
  }

  console.log("== bind (D9 — localhost only) ==");
  const bind = resolveAspaceBind(["127.0.0.1", "100.64.0.7"]);
  check("A'Space bind is always 127.0.0.1 only", bind.hosts.length === 1 && bind.hosts[0] === "127.0.0.1");
  check("upstream tailscale listener is recorded, not honoured", bind.upstreamWouldBind.includes("100.64.0.7"));
  check("loopback-only check passes for 127.0.0.1", isLoopbackOnly(["127.0.0.1"]));
  check("loopback-only check fails for a tailscale IP", !isLoopbackOnly(["127.0.0.1", "100.64.0.7"]));
  throws("assertLoopbackOnly refuses a tailscale listener", () => assertLoopbackOnly(["127.0.0.1", "100.64.0.7"]));

  console.log("== context packs (D4) ==");
  check("taxonomy is the 4 legal values", ATOM_TAXONOMIES.join(",") === "world,lore,skills,mission");
  const packOk = validateContextPackManifest({
    name: "proof-packet",
    taxonomy: "mission",
    files: [{ path: "brief.md", role: "prd", summary: "The brief" }],
  });
  check("a valid manifest validates", packOk.errors.length === 0 && packOk.taxonomy === "mission" && packOk.files === 1, packOk.errors.join("; "));
  const packBadTax = validateContextPackManifest({ taxonomy: "secret", files: [] });
  check("an illegal taxonomy is refused", packBadTax.errors.length === 1);
  const packEscape = validateContextPackManifest({ taxonomy: "lore", files: [{ path: "../etc/passwd", role: "x" }] });
  check("a path escaping the pack is refused", packEscape.errors.length === 1, packEscape.errors.join("; "));
  check("default pack root is $OPENRIG_HOME/context", resolveContextPackRoot("/home/x/.openrig") === "/home/x/.openrig/context");

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log(`failures: ${failures.join(", ")}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`smoke crashed: ${(error as Error).message}`);
  process.exit(1);
});
