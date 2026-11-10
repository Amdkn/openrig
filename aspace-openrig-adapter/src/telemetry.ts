/**
 * @aspace/openrig-adapter — telemetry contract (D-N051 F8, pas 4, D9).
 *
 * The audit's finding (see `openrig-TELEMETRY-AUDIT.md`): the daemon has
 * NO outbound telemetry exporter and NO telemetry SDK in its dependency
 * tree (posthog / sentry / segment / mixpanel / amplitude / datadog /
 * newrelic / opentelemetry = 0 occurrences in every package.json). What it
 * HAS is a LOCAL read surface — `/api/telemetry/*` over the daemon's own
 * SQLite (`usage_samples`), facts only, no account identity in any
 * response (`packages/daemon/src/routes/telemetry.ts`, header 51-08 A3).
 *
 * The adapter enforces the zero-by-default contract at runtime (same
 * pattern as the pi adapter, H-P2-8): it wraps the global `fetch` and
 * denies every non-loopback host unless explicitly allow-listed for the
 * run; known telemetry/analytics hosts are denied even when allow-listed.
 * The daemon's own outbound sites are all gated, never default-allowed:
 * the plugin-vendor fetch (github.com, startup), the Slack gateway
 * (slack.com, key-gated), the OpenRouter charge lookup (openrouter.ai,
 * `--openrouter-charge` only), and remote host pairing (operator URL).
 */

/** The A'Space telemetry contract: NOOP context, zero exporters. */
export const ASPACE_TELEMETRY_CONTRACT = {
  context: "noop",
  exporters: [],
} as const;

/**
 * Hosts that are denied even when allow-listed: telemetry / analytics /
 * crash-reporting vendors. A loopback host never appears here (loopback is
 * the daemon talking to itself).
 */
export const TELEMETRY_BLOCKLIST = [
  "posthog.com",
  "eu.posthog.com",
  "us.posthog.com",
  "sentry.io",
  "ingest.sentry.io",
  "o0.ingest.sentry.io",
  "segment.io",
  "api.segment.io",
  "cdn.segment.com",
  "mixpanel.com",
  "api.mixpanel.com",
  "amplitude.com",
  "api2.amplitude.com",
  "datadoghq.com",
  "browser-intake-datadoghq.com",
  "newrelic.com",
  "nr-data.net",
  "google-analytics.com",
  "www.google-analytics.com",
  "analytics.google.com",
  "hotjar.com",
  "fullstory.com",
  "launchdarkly.com",
] as const;

/**
 * The daemon's own outbound sites (pinned from the gel, NOT allowed by
 * default — each is an explicit opt-in the native daemon does not perform):
 * - github.com — plugin-vendor fetch at startup (`startup.ts:1045`,
 *   `plugin-vendor-service.ts:61`, REPO_BASE mvschwarz/openrig-plugins).
 * - slack.com — Slack gateway (`domain/gateway/slack/slack-api.ts:105`).
 * - openrouter.ai — charge lookup (`adapters/pi-openrouter-charge.ts`,
 *   `--openrouter-charge` only).
 * - a remote host URL — host pairing (`routes/hosts.ts:435`, operator-supplied).
 */
export const DAEMON_OUTBOUND_SITES = ["github.com", "slack.com", "openrouter.ai"] as const;

/** The local telemetry read surface (pinned, routes/telemetry.ts). */
export const TELEMETRY_ROUTES = [
  "/api/telemetry/v1/events",
  "/api/telemetry/v1/queue-transitions",
  "/api/telemetry/v1/nodes/:nodeId/tenures",
  "/api/telemetry/usage/series",
  "/api/telemetry/usage/cost",
  "/api/telemetry/usage/top",
] as const;

/** The error thrown when the outbound guard refuses a fetch. */
export class AspaceOutboundBlockedError extends Error {
  constructor(url: string) {
    super(`outbound fetch blocked by the A'Space zero-telemetry contract: ${url}`);
    this.name = "AspaceOutboundBlockedError";
  }
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

function isBlocklisted(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  return (TELEMETRY_BLOCKLIST as readonly string[]).some(
    (blocked) => host === blocked || host.endsWith(`.${blocked}`),
  );
}

/**
 * Is an outbound URL allowed under the contract? Loopback is always
 * allowed (the daemon talking to itself). Anything else must be explicitly
 * allow-listed for the run — and a blocklisted telemetry/analytics host is
 * denied even then.
 */
export function isOutboundAllowed(url: string, extraHosts: string[] = []): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (isLoopbackHost(parsed.hostname)) return true;
  if (isBlocklisted(parsed.hostname)) return false;
  const allowed = new Set(extraHosts.map((h) => h.toLowerCase()));
  return allowed.has(parsed.hostname.toLowerCase());
}

/**
 * Install the outbound guard: wrap the global `fetch` so every call is
 * judged by `isOutboundAllowed`. Returns a restore function. The guard is
 * the runtime enforcement of the zero-telemetry contract — the daemon's
 * gated outbound sites (github.com, slack.com, openrouter.ai) stay denied
 * unless the caller allow-lists them for this run.
 */
export function installOutboundGuard(opts: { allowHosts?: string[] } = {}): () => void {
  const originalFetch = globalThis.fetch;
  const allowHosts = opts.allowHosts ?? [];
  globalThis.fetch = ((input: unknown, init?: unknown) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as { url?: string }).url ?? "";
    if (!isOutboundAllowed(url, allowHosts)) {
      return Promise.reject(new AspaceOutboundBlockedError(url));
    }
    return (originalFetch as typeof fetch)(input as never, init as never);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}
