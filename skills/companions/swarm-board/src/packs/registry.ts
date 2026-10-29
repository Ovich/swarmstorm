// The registry (board-split#D18, D22): the one table from a run's kind and a seat's role to the member's pack and
// verify setting, and the only place a kind or a role is looked up for it. A new pack is a folder under `src/packs/`
// and a line in PACKS; a new kind or role is a row in MEMBER_ROWS.
import { profileOf } from "../board/kinds.ts";
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
  /** The pack stored under `name` on a member; null for core only or a name no longer registered. */
  packNamed(name: string | null): Pack | null {
    return name !== null && Object.hasOwn(PACKS, name) ? PACKS[name] : null;
  },
};
