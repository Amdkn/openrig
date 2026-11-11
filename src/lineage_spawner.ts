// A'Space OS V5 — OpenRig Genealogical Lineage & Worktree Spawner (578 Holons)
export interface RigLineage { rigId: string; parentHolon: string; childHolon: string; areaCode: string; worktreePath: string; }
export function spawnHolonRig(parentHolon: string, childHolon: string, areaCode: string): RigLineage {
  const rigId = `RIG-${areaCode}-${childHolon}-${Date.now()}`;
  return { rigId, parentHolon, childHolon, areaCode, worktreePath: `.worktrees/${rigId}` };
}
