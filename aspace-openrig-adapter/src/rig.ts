/**
 * @aspace/openrig-adapter — rig model (D-N051 F8, pas 4).
 *
 * The rig model pinned on the gel (bd39da9, 0.7.1), mirrored verbatim from
 * `packages/daemon/src/domain/types.ts` (Rig :3, Pod :10, Node :29,
 * Edge :75, Binding :84, Session :100). These are the A'Space-side types:
 * the adapter validates a parsed rig spec against them; it never re-implements
 * the daemon's repository, migrations, or YAML parser.
 *
 * Rig YAML shape (starter `packages/daemon/specs/rigs/launch/starter/rig.yaml`,
 * 1 pod / 2 members / 1 edge; `focused/code-review/rig.yaml`,
 * 2 pods / 3 members / 2 edges):
 * pods -> members (id, agent_ref, runtime, model, profile, cwd, startup)
 * -> edges (kind, from, to). Members declare NO role in the YAML — the
 * daemon's `Node.role` column is nullable and set at runtime; a role in
 * the spec, when present, must be one of the pinned roles. Edge endpoints
 * may be qualified `pod.member` (as in code-review) or bare member ids.
 */

/** Roles the starter rig declares for its members (pinned, D2). */
export const RIG_ROLES = ["lead", "worker", "reviewer", "kernel operator"] as const;
export type RigRole = (typeof RIG_ROLES)[number];

/** Runtimes the harness adapters cover (interface unchanged, D2). */
export const RIG_RUNTIMES = ["claude-code", "codex", "pi", "omp"] as const;
export type RigRuntime = (typeof RIG_RUNTIMES)[number];

/** A rig: the unit the daemon manages (types.ts:3). */
export interface Rig {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/** A pod: a namespace of seats inside a rig (types.ts:10). */
export interface Pod {
  id: string;
  rigId: string;
  namespace: string;
  label: string;
  summary: string | null;
  continuityPolicyJson: string | null;
  createdAt: string;
}

/**
 * A node: one seat / member of a rig (types.ts:29). The daemon's Node carries
 * ~25 fields (handover, resume ledger, advisor, token refs); the adapter
 * pins the identity + placement fields the rig spec declares and the lineage
 * scheduler needs. The rest is daemon state, not adapter surface.
 */
export interface RigNode {
  id: string;
  rigId: string;
  logicalId: string;
  role: string | null;
  runtime: string | null;
  model: string | null;
  cwd: string | null;
  workspace: string | null;
  podId: string | null;
  agentRef: string | null;
  profile: string | null;
  label: string | null;
  createdAt: string;
}

/** An edge: a delegation / relation between two nodes (types.ts:75). */
export interface RigEdge {
  id: string;
  rigId: string;
  sourceId: string;
  /** Node ID, or the declared address when targetRef is present. */
  targetId: string;
  targetRef?: string;
  kind: string;
  createdAt: string;
}

/**
 * A binding: a seat's attachment to a live terminal (types.ts:84).
 * `attachmentType` is `tmux` or `external_cli`; Herdr seats attach through
 * the socket transport (cmuxSurface) — never through the `hc` CLI.
 */
export interface RigBinding {
  id: string;
  nodeId: string;
  attachmentType?: "tmux" | "external_cli";
  tmuxSession: string | null;
  tmuxWindow: string | null;
  tmuxPane: string | null;
  externalSessionName?: string | null;
  cmuxWorkspace: string | null;
  cmuxSurface: string | null;
  updatedAt: string;
}

/** A session: a seat's run, resumable via its token (types.ts:100). */
export interface RigSession {
  id: string;
  nodeId: string;
  sessionName: string;
  status: string;
  resumeType: string | null;
  resumeToken: string | null;
  restorePolicy: string;
  lastSeenAt: string | null;
  createdAt: string;
  origin: "launched" | "claimed";
  startupStatus: "pending" | "ready" | "attention_required" | "failed";
  startupCompletedAt: string | null;
}

/**
 * The parsed rig YAML, as the daemon's spec parser hands it over:
 * pods, each with members and edges. Field names follow the YAML
 * (`agent_ref`, `delegates_to`), not the DB columns.
 */
export interface ParsedRigSpec {
  rig?: { name?: string; id?: string };
  pods?: Array<{
    id?: string;
    label?: string;
    members?: Array<{
      id?: string;
      agent_ref?: string;
      runtime?: string;
      model?: string;
      profile?: string;
      cwd?: string;
      role?: string;
      startup?: unknown;
    }>;
    edges?: Array<{ from?: string; to?: string; kind?: string; delegates_to?: string }>;
  }>;
  // The starter YAML nests members/edges under each pod; a flat shape is
  // accepted too (members/edges at the rig level).
  members?: ParsedRigSpec["pods"] extends Array<infer P> ? P extends { members?: infer M } ? M : never : never;
  edges?: Array<{ from?: string; to?: string; kind?: string; delegates_to?: string }>;
}

export interface RigSpecValidation {
  errors: string[];
  pods: number;
  members: number;
  edges: number;
}

/**
 * Validate a parsed rig spec against the pinned model. Pure: no I/O, no
 * daemon, no YAML parser — the caller parses, the adapter judges.
 *
 * Checks: every pod has an id; every member has an id, an agent_ref, and
 * a runtime in the pinned harness set; a member role, when present, is in
 * the pinned role set (the YAML declares no role — the daemon sets
 * `Node.role` at runtime); every edge references members that exist
 * (bare id, or qualified `pod.member`); member ids are unique within the
 * rig.
 */
export function validateRigSpec(spec: unknown): RigSpecValidation {
  const errors: string[] = [];
  let pods = 0;
  let members = 0;
  let edges = 0;
  if (spec === null || typeof spec !== "object" || Array.isArray(spec)) {
    return { errors: ["rig spec must be a mapping (pods -> members -> edges)"], pods, members, edges };
  }
  const root = spec as ParsedRigSpec;
  const podList = Array.isArray(root.pods) ? root.pods : [];
  pods = podList.length;
  if (pods === 0) errors.push("rig spec declares no pods");
  const memberIds = new Set<string>();
  const membersByPod = new Map<string, Set<string>>();
  const resolveEndpoint = (ref: string): boolean => {
    if (memberIds.has(ref)) return true;
    const dot = ref.indexOf(".");
    if (dot > 0) {
      const podMembers = membersByPod.get(ref.slice(0, dot));
      if (podMembers?.has(ref.slice(dot + 1))) return true;
    }
    return false;
  };
  const collectMembers = (list: NonNullable<ParsedRigSpec["pods"]>[number]["members"] | undefined, where: string) => {
    const podId = where.replace(/^pod /, "");
    const podSet = membersByPod.get(podId) ?? new Set<string>();
    membersByPod.set(podId, podSet);
    for (const m of list ?? []) {
      members++;
      if (typeof m?.id !== "string" || m.id.length === 0) {
        errors.push(`${where}: member without an id`);
        continue;
      }
      if (memberIds.has(m.id)) errors.push(`${where}: duplicate member id ${m.id}`);
      memberIds.add(m.id);
      podSet.add(m.id);
      if (typeof m.agent_ref !== "string" || m.agent_ref.length === 0) {
        errors.push(`${where}: member ${m.id} without agent_ref`);
      }
      if (typeof m.runtime !== "string" || !(RIG_RUNTIMES as readonly string[]).includes(m.runtime)) {
        errors.push(`${where}: member ${m.id} runtime ${JSON.stringify(m.runtime)} not in ${RIG_RUNTIMES.join(", ")}`);
      }
      if (m.role !== undefined && (typeof m.role !== "string" || !(RIG_ROLES as readonly string[]).includes(m.role))) {
        errors.push(`${where}: member ${m.id} role ${JSON.stringify(m.role)} not in ${RIG_ROLES.join(", ")}`);
      }
    }
  };
  const collectEdges = (list: NonNullable<ParsedRigSpec["pods"]>[number]["edges"] | undefined, where: string) => {
    for (const e of list ?? []) {
      edges++;
      const from = typeof e?.from === "string" ? e.from : undefined;
      const to = typeof e?.to === "string" ? e.to : typeof e?.delegates_to === "string" ? e.delegates_to : undefined;
      if (!from) errors.push(`${where}: edge without a source`);
      else if (!resolveEndpoint(from)) errors.push(`${where}: edge source ${from} is not a declared member`);
      if (!to) errors.push(`${where}: edge without a target`);
      else if (!resolveEndpoint(to)) errors.push(`${where}: edge target ${to} is not a declared member`);
    }
  };
  for (const pod of podList) {
    const where = `pod ${pod?.id ?? "?"}`;
    if (typeof pod?.id !== "string" || pod.id.length === 0) errors.push("pod without an id");
    collectMembers(pod?.members, where);
    collectEdges(pod?.edges, where);
  }
  // Flat shape (members/edges at the rig level) — validated the same way.
  collectMembers(root.members as never, "rig");
  collectEdges(root.edges, "rig");
  return { errors, pods, members, edges };
}
