/**
 * @aspace/openrig-adapter — context packs (D-N051 F8, pas 4, D4).
 *
 * Pinned from `packages/daemon/src/domain/context-packs/context-pack-types.ts`
 * (PL-014, Rig Context / Composable Context Injection v0):
 * - A context_pack is a directory containing `manifest.yaml` + included
 *   markdown / yaml / txt files. Operator-authored, library-discoverable,
 *   reviewable, sendable.
 * - Storage is filesystem-canonical at `<context.root>/<ref>/`
 *   (default `$OPENRIG_HOME/context`) + workspace-local
 *   `.openrig/context-packs/<name>/`.
 * - NO new SQLite tables; the library cache is in-memory at the daemon scope.
 * - The taxonomy is ONE definition site (`ATOM_TAXONOMIES`): every manifest
 *   answers "what kind of context am I" through it.
 *
 * The adapter validates manifests against that single definition site; the
 * native port (`openrig_context_packs` in RigInfinity) loads packs from
 * disk with the same taxonomy and the same no-SQLite rule.
 */

import { join } from "node:path";

/** The one taxonomy definition site (context-pack-types.ts). */
export const ATOM_TAXONOMIES = ["world", "lore", "skills", "mission"] as const;
export type AtomTaxonomy = (typeof ATOM_TAXONOMIES)[number];

/** The teaching the daemon parser and the CLI validator share (OPR.0.5.6.10). */
export const TAXONOMY_TEACHING =
  `Legal values: ${ATOM_TAXONOMIES.join(" | ")}. ` +
  "world = where you are (the environment: entities, rules, affordances); " +
  "lore = what has been learned here (position knowledge earned in place); " +
  "skills = what you know how to do (procedural capability); " +
  "mission = what you are doing now (the current work and its intent). " +
  "Add one line to manifest.yaml, e.g. `taxonomy: skills`.";

export interface ContextPackManifestFile {
  /** Relative path within the pack directory. */
  path: string;
  /** Free-form operator-defined role (e.g. "prd", "proof-packet"). */
  role: string;
  /** One-line description rendered in the review pane and bundle frame. */
  summary?: string;
}

export interface ContextPackManifest {
  name?: string;
  taxonomy?: string;
  files?: ContextPackManifestFile[];
  [key: string]: unknown;
}

export interface ContextPackValidation {
  errors: string[];
  taxonomy: AtomTaxonomy | null;
  files: number;
}

/**
 * Validate a context-pack manifest (already parsed from `manifest.yaml`).
 * The taxonomy must be one of the four legal values; every listed file
 * needs a path and a role; paths must stay inside the pack directory
 * (no `..` escape, no absolute path).
 */
export function validateContextPackManifest(manifest: unknown): ContextPackValidation {
  const errors: string[] = [];
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    return { errors: ["context-pack manifest must be a mapping"], taxonomy: null, files: 0 };
  }
  const m = manifest as ContextPackManifest;
  let taxonomy: AtomTaxonomy | null = null;
  if (typeof m.taxonomy !== "string" || !(ATOM_TAXONOMIES as readonly string[]).includes(m.taxonomy)) {
    errors.push(`manifest taxonomy ${JSON.stringify(m.taxonomy)} is not one of ${ATOM_TAXONOMIES.join(" | ")} — ${TAXONOMY_TEACHING}`);
  } else {
    taxonomy = m.taxonomy as AtomTaxonomy;
  }
  const files = Array.isArray(m.files) ? m.files : [];
  if (!Array.isArray(m.files)) errors.push("manifest files must be a list");
  for (const f of files) {
    if (typeof f?.path !== "string" || f.path.length === 0) {
      errors.push("manifest file without a path");
      continue;
    }
    if (f.path.startsWith("/") || f.path.split("/").includes("..")) {
      errors.push(`manifest file path ${JSON.stringify(f.path)} escapes the pack directory`);
    }
    if (typeof f.role !== "string" || f.role.length === 0) {
      errors.push(`manifest file ${f.path} without a role`);
    }
  }
  return { errors, taxonomy, files: files.length };
}

/** The default context-pack root: `$OPENRIG_HOME/context`. */
export function resolveContextPackRoot(openrigHome: string): string {
  return join(openrigHome, "context");
}
