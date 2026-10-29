// The registry (board-split#D18, D22): the one table from a run's kind and a seat's role to the member's pack and
// verify setting, and the only place a kind or a role is looked up for it. A new pack is a folder under `src/packs/`
// and a line in PACKS; a new kind or role is a row in MEMBER_ROWS.
import { profileOf } from "../board/kinds.ts";
import type * as CoreStats from "../board/stats.ts";
import type { StatsFigures } from "../board/stats.ts";
import type { CodeMemberStats, CodeRunStats, CodeTotals, FileAcrossRuns, PlanRunStats, SharedFile } from "./code/stats.ts";
import { codePack } from "./code/index.ts";
import type { Kind, MemberPackRow, Pack } from "./types.ts";

/** Every pack, by its name. */
const PACKS: Record<string, Pack> = { [codePack.name]: codePack };

/** `role: null` is the kind's default, for a seat whose role has no row of its own (D11). */
type MemberRowSpec = { kind: Kind; role: string | null; pack: string | null; verify: boolean };

const MEMBER_ROWS: MemberRowSpec[] = [
  { kind: "plan", role: null, pack: "code", verify: false },
  { kind: "plan", role: "verifier", pack: null, verify: true },
  { kind: "task", role: null, pack: "code", verify: false },
  { kind: "task", role: "verifier", pack: null, verify: true },
  { kind: "brainstorm", role: null, pack: null, verify: false },
];

const rowOf = (spec: MemberRowSpec): MemberPackRow => ({ pack: spec.pack === null ? null : PACKS[spec.pack], verify: spec.verify });

export const registry = {
  /** The member's pack and verify setting for a seat of `role` in a run of `kind`; throws on an unknown kind. */
  forMember(kind: string, role: string | null): MemberPackRow {
    const known = profileOf(kind).kind;
    const own = role === null ? undefined : MEMBER_ROWS.find((r) => r.kind === known && r.role === role);
    return rowOf(own ?? MEMBER_ROWS.find((r) => r.kind === known && r.role === null)!);
  },
  /** Every pack's part of `swarm stats` (D15), in PACKS' order. */
  statsFigures(): StatsFigures[] {
    return Object.values(PACKS).flatMap((p) => (p.stats ? [p.stats] : []));
  },
  /** The pack stored under `name` on a member; null for core only or a name no longer registered. */
  packNamed(name: string | null): Pack | null {
    return name !== null && Object.hasOwn(PACKS, name) ? PACKS[name] : null;
  },
};

// `swarm stats` as it reads with every pack's figures (D15): the core's shape and each pack's fields, the types the
// CLI and aiview read the JSON by.
export type MemberStats = CoreStats.MemberStats & CodeMemberStats;
export type RunStats = Omit<CoreStats.RunStats, "members"> & CodeRunStats & { members: MemberStats[] };
export type Totals = Omit<CoreStats.Totals, "series"> &
  CodeTotals & { series: CoreStats.Totals["series"] & Record<"slicesMerged" | "sliceTimeP50" | "lockWaitP50" | "sharedAgreed" | "flags" | "conflicts", (number | null)[]> };
export type Stats = Omit<CoreStats.Stats, "runs" | "totals" | "files"> & { runs: RunStats[]; totals: Totals; files: FileAcrossRuns[] };
export type { FileAcrossRuns, PlanRunStats, SharedFile };
export type { PackCtx } from "./types.ts";
