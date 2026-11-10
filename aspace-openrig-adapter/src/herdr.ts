/**
 * @aspace/openrig-adapter — Herdr terminal transport policy (D-N051 F8, pas 4).
 *
 * Herdr (`hc`) is an AGPL terminal multiplexer. OpenRig integrates it at
 * ARM'S LENGTH (`packages/daemon/src/domain/terminal/herdr-transport.ts`,
 * header OPR.0.4.6.02 FB4): the daemon talks to herdr's local unix-domain
 * CONTROL SOCKET — a runtime IPC endpoint the operator's installed herdr
 * exposes — exactly the way it shells out to tmux/cmux. It never imports,
 * links, embeds, or vendors herdr code.
 *
 * The adapter pins that boundary: the socket protocol (NDJSON
 * `{id,method,params}` -> `{id,result}`, NOT JSON-RPC 2.0), the socket path
 * resolution, the 8 methods the adapter calls, and the rule that no `hc`
 * CLI invocation ever happens outside a rig (H-P4-6). The native port
 * (`openrig_terminal` in RigInfinity) speaks the same socket, in Rust.
 */

import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The Herdr socket methods the daemon calls (pinned from
 * `packages/daemon/src/domain/terminal/herdr-adapter.ts` +
 * `herdr-transport.ts`). Any other method is a design event, not a silent
 * addition.
 */
export const HERDR_SOCKET_METHODS = [
  "ping",
  "pane.list",
  "pane.report_agent_session",
  "workspace.list",
  "workspace.create",
  "layout.apply",
  "tab.focus",
  "tab.close",
] as const;
export type HerdrSocketMethod = (typeof HERDR_SOCKET_METHODS)[number];

/** Default Herdr control-socket path (upstream default). */
export const HERDR_DEFAULT_SOCKET = "~/.config/herdr/herdr.sock";

/**
 * Resolve the Herdr control-socket path, upstream semantics
 * (`resolveHerdrSocketPath(env, session?)`): `HERDR_SOCKET_PATH` wins;
 * otherwise the default under the config home. A named session
 * (`HERDR_SESSION`) selects a per-session socket when given.
 */
export function resolveHerdrSocketPath(
  env: NodeJS.ProcessEnv = process.env,
  session?: string,
): string {
  const fromEnv = env.HERDR_SOCKET_PATH;
  if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv;
  const configHome = env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  const name = session ?? env.HERDR_SESSION;
  return join(configHome, "herdr", name ? `${name}.sock` : "herdr.sock");
}

/** The error thrown when code tries to invoke the `hc` CLI directly. */
export class DirectHcCallError extends Error {
  constructor(command: string) {
    super(
      `direct hc CLI invocation is forbidden outside the rig socket transport: ${command} — ` +
        `Herdr is reached only through its control socket (arm's-length AGPL boundary, H-P4-6)`,
    );
    this.name = "DirectHcCallError";
  }
}

/**
 * Assert a shell command does not invoke the `hc` CLI. The adapter (and the
 * native port) never shell out to `hc`: layout, panes and workspaces go
 * through the socket JSON-RPC. A command that would call `hc` is refused
 * before it runs.
 */
export function assertNoDirectHcCall(command: string): void {
  const argv = command.trim().split(/\s+/);
  const program = argv[0]?.split("/").pop() ?? "";
  if (program === "hc" || program === "herdr") {
    throw new DirectHcCallError(command);
  }
  // `herdr` as an argument to a shell / env wrapper still reaches the CLI.
  if (argv.some((a) => a === "hc" || a === "herdr")) {
    throw new DirectHcCallError(command);
  }
}

/** One pane as `pane.list` reports it (subset the adapter judges). */
export interface HerdrPane {
  /** Pane id (upstream: the pane's id in the workspace). */
  id: string;
  /** Workspace the pane belongs to. */
  workspace_id?: string;
  /** The session the pane runs, when the daemon attached one. */
  session?: string;
  /** The rig seat this pane is bound to, when registered. */
  seat_id?: string;
}

/**
 * Find orphan sessions (H-P4-3): panes reported by Herdr that are not
 * attached to any seat registered in the rig's bindings. A pane is
 * attached when its `seat_id` (or its `session` name) matches a binding's
 * seat. Returns the orphan pane ids — empty means zero orphans.
 *
 * Pure: the caller lists the panes (socket `pane.list`) and the bindings
 * (the state store); the adapter judges.
 */
export function findOrphanSessions(
  panes: HerdrPane[],
  bindings: Array<{ nodeId: string; sessionName?: string | null }>,
): string[] {
  const attached = new Set<string>();
  for (const b of bindings) {
    attached.add(b.nodeId);
    if (b.sessionName) attached.add(b.sessionName);
  }
  const orphans: string[] = [];
  for (const pane of panes) {
    const keys = [pane.seat_id, pane.session].filter((k): k is string => typeof k === "string" && k.length > 0);
    const isAttached = keys.length > 0 && keys.some((k) => attached.has(k));
    if (!isAttached) orphans.push(pane.id);
  }
  return orphans;
}

/** H-P4-3 verdict: zero orphans, or the list of them. */
export function verifyNoOrphanSessions(
  panes: HerdrPane[],
  bindings: Array<{ nodeId: string; sessionName?: string | null }>,
): { ok: boolean; orphans: string[] } {
  const orphans = findOrphanSessions(panes, bindings);
  return { ok: orphans.length === 0, orphans };
}
