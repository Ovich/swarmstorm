import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * The colour of a kind chip.
 *
 * It used to be a hash of the name, which is deterministic and useless: `plan` 97,
 * `reference` 107, `architecture` 115 and `roadmap` 116 all landed inside twenty degrees
 * of the same green, and `spec` 187 and `report` 188 were one degree apart. A person
 * reading a sidebar of a dozen documents could not tell a plan from a roadmap by colour,
 * which is the only thing the chip is for.
 *
 * Even spacing was the second attempt, eleven hues 33 degrees apart, and it failed at
 * the chip's own lightness: at 94% every hue is pastel, and three greens, two blues and
 * two purples sat side by side in the sidebar indistinguishable. Hue alone cannot carry
 * thirteen kinds.
 *
 * So each kind has two channels. Its hue, one of eleven named colours a reader can call
 * out (red, orange, amber, lime, green, teal, blue, indigo, violet, purple, magenta),
 * and its tone: `strong` fills the chip, `light` tints it. Neighbours on the wheel
 * alternate tone, so two kinds one spoke apart never share both. Pairs that appear
 * together are pushed apart in hue as well: a plan beside its slices and its
 * verifications, a board beside its spec, a roadmap beside its reference, the feature
 * map beside its verifications, a workbench beside the prototypes and reports it sits
 * among. `pdf` is a foreign format and takes the one grey.
 *
 * A kind not listed here still gets a stable colour from the old hash, moved off the
 * spokes above so a new kind cannot be born looking like an existing one.
 */
export type KindTone = "strong" | "light";
const KIND_COLORS: Record<string, { h: number; s: number; tone: KindTone }> = {
  roadmap: { h: 0, s: 70, tone: "strong" },
  report: { h: 30, s: 70, tone: "light" },
  verification: { h: 50, s: 80, tone: "strong" },
  prototype: { h: 85, s: 65, tone: "light" },
  // legacy: a mockup row not yet migrated keeps the prototype colour
  mockup: { h: 85, s: 65, tone: "light" },
  // A swarm run sits beside its plan and slices: off both in hue, more saturated than the slice.
  swarm: { h: 110, s: 80, tone: "strong" },
  seat: { h: 130, s: 55, tone: "strong" },
  spec: { h: 170, s: 60, tone: "light" },
  plan: { h: 205, s: 70, tone: "strong" },
  reference: { h: 235, s: 60, tone: "light" },
  "feature-map": { h: 265, s: 55, tone: "strong" },
  brainstorm: { h: 295, s: 60, tone: "light" },
  "pr-analysis": { h: 330, s: 65, tone: "strong" },
  workbench: { h: 345, s: 70, tone: "light" },
  pdf: { h: 0, s: 0, tone: "light" },
};

/** Hue, saturation and tone for a kind. Hand-placed where it matters, hashed where it does not. */
export function kindColor(kind: string): { h: number; s: number; tone: KindTone } {
  const named = KIND_COLORS[kind];
  if (named) return named;
  let h = 0;
  for (const c of kind) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  // 16 degrees off every hand-placed spoke, which sit on multiples of about 33.
  return { h: (((h % 11) * 33 + 16) % 360), s: 44, tone: "light" };
}

/** The hue alone. Kept because the tests and any older caller ask for a number. */
export function kindHue(kind: string): number {
  return kindColor(kind).h;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 2026-08-23 11:28 — the monospace start stamp. */
export function fmtStart(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "2 min ago" / "Aug 21" — the updated stamp. */
export function fmtUpdated(iso: string): string {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "2-digit" });
}

export const projectName = (p: string): string =>
  p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? p;

/** Middle-truncate a path keeping the filename visible. */
export function truncatePath(p: string, max = 72): string {
  if (p.length <= max) return p;
  const sep = p.includes("\\") ? "\\" : "/";
  const parts = p.split(sep);
  const file = parts.pop() ?? "";
  let head = parts.join(sep);
  const room = max - file.length - 2;
  if (room <= 0) return `…${sep}${file}`;
  head = head.slice(0, room);
  return `${head}…${sep}${file}`;
}
