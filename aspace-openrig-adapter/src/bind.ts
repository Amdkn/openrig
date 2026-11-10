/**
 * @aspace/openrig-adapter — bind enforcement (D-N051 F8, pas 4, D9).
 *
 * Upstream bind policy (`packages/daemon/src/domain/bind-plan.ts`,
 * OPR.0.5.5.20): bind intent comes ONLY through the dedicated
 * `OPENRIG_BIND_HOST` env; the default is `["127.0.0.1"]` — PLUS the
 * tailscale interface IP when one is present — and an explicit
 * `OPENRIG_BIND_HOST` overrides. The overloaded routing env
 * (`OPENRIG_HOST` / `RIGGED_HOST`) is observed, never consulted for bind
 * policy.
 *
 * A'Space policy is stricter: the unique daemon binds 127.0.0.1 ONLY.
 * No tailscale listener, no explicit override — a second listener is a
 * second exposure surface, and the tailnet is a routing concern, not a
 * bind concern. The adapter enforces this by resolving the bind plan
 * itself and refusing anything but loopback.
 */

export interface AspaceBindPlan {
  mode: "aspace-localhost-only";
  hosts: ["127.0.0.1"];
  /** The upstream plan this policy overrides (for the audit trail). */
  upstreamWouldBind: string[];
}

/**
 * Resolve the A'Space bind plan: always `["127.0.0.1"]`, whatever the
 * environment says. `upstreamWouldBind` records what the upstream resolver
 * would have bound (tailscale IP included when present), so the override
 * is visible, never silent.
 */
export function resolveAspaceBind(upstreamHosts: string[] = ["127.0.0.1"]): AspaceBindPlan {
  return {
    mode: "aspace-localhost-only",
    hosts: ["127.0.0.1"],
    upstreamWouldBind: [...upstreamHosts],
  };
}

/** True when a host list is loopback-only (the only acceptable bind). */
export function isLoopbackOnly(hosts: readonly string[]): boolean {
  return hosts.length > 0 && hosts.every((h) => h === "127.0.0.1" || h === "localhost" || h === "::1");
}

/** Assert a host list is loopback-only; throw otherwise. */
export function assertLoopbackOnly(hosts: readonly string[]): void {
  if (!isLoopbackOnly(hosts)) {
    throw new Error(
      `bind refused: the A'Space daemon binds 127.0.0.1 only, got [${hosts.join(", ")}] — ` +
        `a tailscale or LAN listener is a design event, not a default`,
    );
  }
}
