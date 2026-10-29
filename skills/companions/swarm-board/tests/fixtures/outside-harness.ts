// The suite runs outside a harness session (swarm-relay D39), even when started from inside one: a verb then starts a
// detached link as before, instead of waiting 10 s for an agent's own. A test of the harness case sets the variable itself.
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";

delete process.env.CLAUDE_CODE_SESSION_ID;
// Every test home is a temporary one: printed commands stay bare, as the suite's patterns expect (G3 has its own test).
process.env.SWARMSTORM_PRINT_HOME = "0";

// board-split#D39: a child a test starts opens no console window on the person's desktop. Every child_process
// starter defaults to `windowsHide: true`; a caller's own option still wins. The options each starter was given
// are kept for tests/windows-hide.test.ts.
type Starter = (...a: unknown[]) => unknown;
const seen: Record<string, unknown>[] = [];
(globalThis as { __childOptionsSeen?: Record<string, unknown>[] }).__childOptionsSeen = seen;

const isOptions = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** `argsAt`: the position of an optional args array before the options (spawn, execFile, fork), or null (exec). */
function hiding(original: Starter, argsAt: number | null): Starter {
  return function (this: unknown, ...a: unknown[]) {
    const at = argsAt !== null && Array.isArray(a[argsAt]) ? argsAt + 1 : argsAt ?? 1;
    if (isOptions(a[at])) a[at] = { windowsHide: true, ...a[at] };
    else a.splice(at, a[at] === undefined && a.length > at ? 1 : 0, { windowsHide: true });
    seen.push(a[at] as Record<string, unknown>);
    return original.apply(this, a);
  };
}

const cp = childProcess as unknown as Record<string, Starter>;
for (const name of ["spawn", "spawnSync", "execFile", "execFileSync", "fork"]) cp[name] = hiding(cp[name], 1);
for (const name of ["exec", "execSync"]) cp[name] = hiding(cp[name], null);
// named imports of node:child_process read the patched starters from here on
syncBuiltinESMExports();
