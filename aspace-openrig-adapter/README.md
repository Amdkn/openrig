# @aspace/openrig-adapter

The only A'Space code in this fork (D-N051 F8, pas 4 — openrig, le corps).
The upstream OpenRig runtime is never modified (byte-identical to the frozen
commit). Every A'Space adaptation lives here, behind this stable surface.

## Frozen upstream

| Item | Value |
|---|---|
| Upstream | `mvschwarz/openrig` |
| Fork | `Amdkn/openrig`, branch `main` |
| Gel (frozen commit) | `bd39da9` — `bd39da9872afc39cbe0c8e839a322b4cb8955cbe` |
| Gel date / title | 2026-11-05T21:03:09Z — "fix(compaction): deliver a held post-compaction step after two idle unreadable polls (#2576)" |
| Gel version | **0.7.1** |
| Pin (bind) | `adafb0d` — `adafb0d16a83dd557c524bbe9d19c9a11e188f15` (2026-11-07, `aspace-plugin.json` + `src/lineage_spawner.ts`) |
| Pin parent | `781b5fb` (docs: what 0.7.8 added) |

**Version drift (D7): the gel is 0.7.1; the docs cite 0.7.5 / 0.7.8.** The
docs are ahead of the frozen code. Never claim 0.7.5 / 0.7.8 compatibility
for the gel. The drift of the gel moves (upstream pushes ~2 commits per
25 min); the gel is never re-frozen on the live head (D1) — a drift is a
named design event, revisited on signal.

## What the adapter is

The openrig daemon is retired: its functions live in the RigInfinity
unique daemon (Rust). The adapter is the contract layer between the
upstream surface and that daemon — it pins the surface, replaces the
lifecycle and the spawner, and enforces the zero-telemetry contract.

| Module | What it does |
|---|---|
| `src/rig.ts` | Rig / Pod / Node (seat) / Edge / Binding / Session model, mirrored from `packages/daemon/src/domain/types.ts`; `validateRigSpec()` for a parsed rig YAML (pods → members → edges; role optional — the YAML declares none, the daemon sets `Node.role` at runtime; edges resolve bare ids and `pod.member`) |
| `src/lineage.ts` | The lineage scheduler — **replaces** the bind's `spawnHolonRig()` (a declaration with `Date.now()` uniqueness). Rig ids are `RIG-<area>-<holon>-<ULID26>` (monotonic ULID, same family the daemon uses); worktrees stay `.worktrees/<rigId>` |
| `src/herdr.ts` | Herdr socket policy: NDJSON `{id,method,params}` over `~/.config/herdr/herdr.sock`, 8 pinned methods; `assertNoDirectHcCall()` (no `hc` CLI, ever — arm's-length AGPL boundary); `findOrphanSessions()` (H-P4-3) |
| `src/lifecycle.ts` | **Replaces** the CLI lifecycle (`packages/cli/src/daemon-*.ts`, not ported): unique-daemon endpoint (loopback only), `/healthz` probe (500 ms, 3-state semantics), PID start lock, TUI re-pointing (D3) |
| `src/telemetry.ts` | Zero-telemetry contract: `ASPACE_TELEMETRY_CONTRACT` (noop, zero exporters); `installOutboundGuard()` wraps global `fetch` (loopback only by default; telemetry/analytics hosts blocklisted even when allow-listed) |
| `src/bind.ts` | Bind enforcement: the unique daemon binds **127.0.0.1 only** — it overrides the upstream default that also listens on the tailscale IP when one is present |
| `src/context-packs.ts` | Context-pack manifest validation; taxonomy `world \| lore \| skills \| mission` (the one definition site); storage `$OPENRIG_HOME/context`, no SQLite tables |
| `src/index.ts` | Pinned constants (`PINNED_OPENRIG_COMMIT`, `PINNED_SURFACE`, `VERSION_DRIFT`) + frozen-commit / frozen-lineage verification (H-M2) |

## What is NOT in the adapter (out of scope, by design)

- **The Hono HTTP server** (`packages/daemon/src/server.ts`, `routes/`) — the
  routes are re-implemented in Rust in RigInfinity, not ported.
- **The TUI / UI as code** (`packages/tui`, `packages/ui`) — surfaces only.
  The TUI's daemon connection is re-pointed to the unique daemon
  (`resolveTuiEndpoint()`); no TUI file is touched.
- **The providers** (claude-code, codex, pi, omp harness adapters) — their
  interfaces are unchanged; they run via the unique daemon.
- **`test-system`** — the suite's tooling, used by H-M3, not adapted.
- **Any upstream file** — the diff is the adapter alone (H-M2).

## The openrig daemon, retired

The daemon's three functions live in the unique daemon (RigInfinity,
`aspace-v5-native`):

| Daemon function | Native module |
|---|---|
| SQLite state (`<OPENRIG_HOME>/openrig.sqlite`, 146 migrations) | `openrig_state` (rusqlite, core tables: rigs, pods, nodes, edges, bindings, sessions, events, usage samples) |
| Context packs (filesystem, taxonomy, in-memory cache) | `openrig_context_packs` (serde_yaml manifests) |
| Herdr terminal transport (socket JSON-RPC) | `openrig_terminal` (Unix socket client, arm's-length) |
| Lineage spawner (`Date.now()`) | `openrig_lineage` (ULID scheduler) |

The daemon's own outbound sites are all gated, never default-allowed:
plugin-vendor fetch (`github.com/mvschwarz/openrig-plugins` at startup),
Slack gateway (`slack.com`, key-gated), OpenRouter charge lookup
(`openrouter.ai`, `--openrouter-charge` only), remote host pairing
(operator-supplied URL). See `openrig-TELEMETRY-AUDIT.md` (evidence
D-N051, `p4/`).

## Run the smoke

```sh
node --experimental-strip-types aspace-openrig-adapter/smoke_test.ts
```

Exit 0 = all checks green; exit 1 = at least one check red (named).
Every check is local (git reads, file reads, pure functions, a loopback
stub server, the fetch guard) — the smoke passes with no network at all.
The rig-YAML check uses the workspace `yaml` package (a declared
dependency of `@openrig/daemon`): run `npm ci` at the repo root first.
