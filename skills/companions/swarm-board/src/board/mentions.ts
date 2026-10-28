// Mention parsing: what an `@…` in a body names, resolved against the sender's plan.
// A target is a member name `<plan>/<seat>` or `<plan>/*` for every member of a plan.

/** The two-letter code a plan is shown under (D30): the initials of its first two words,
 *  dates dropped; a single word gives its first two letters. `review-tool` → `RT`. */
export function planCode(plan: string): string {
  const words = plan.split(/[-_\s.]+/).filter((w) => w && !/^\d+$/.test(w));
  if (words.length === 0) return plan.slice(0, 2).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** A bare token that reads as a run code: two letters, any case. */
const isCodeShaped = (token: string): boolean => /^[A-Za-z]{2}$/.test(token);
const plansOfCode = (code: string, plans: string[]): string[] => plans.filter((plan) => planCode(plan) === code.toUpperCase());

const MENTION = /(?<![\w@])@([A-Za-z0-9][\w.\-]*(?:[\/·][A-Za-z0-9][\w.\-]*)?)/g;

/** How a member's funny name is written in a mention (D43): "Sleepy Otter" → `sleepyotter`,
 *  compared without case. */
export const nameHandle = (nick: string): string => nick.replace(/\s+/g, "").toLowerCase();

/**
 * The targets a body mentions (D3). `@S3` and `@orchestrator` are the sender's plan; `@swarm`
 * is every member of the sender's plan; `@IW`, an open plan's two-letter code alone, is every
 * member of that plan, and wins over a seat of that name in the sender's plan; `@<plan>/S3` and
 * `@<code>·S3` cross plans. A code is resolved against `plans`, the plans open on the
 * repository; an unknown code is dropped. `@all` names nobody.
 * `@SleepyOtter` is the member of that funny name, whatever its plan: `names` maps each
 * active member's `nameHandle` to its `<plan>/<seat>`.
 */
export function parseMentions(body: string, senderPlan: string, plans: string[], names?: ReadonlyMap<string, string>): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(MENTION)) {
    const token = m[1].replace(/[.\-]+$/, "");
    const named = names?.get(token.toLowerCase());
    if (named) {
      out.add(named);
    } else if (token.includes("/")) {
      const [plan, seat] = token.split("/");
      out.add(`${plan}/${seat === "all" ? "*" : seat}`);
    } else if (token.includes("·")) {
      const [code, seat] = token.split("·");
      for (const plan of plans) if (planCode(plan) === code.toUpperCase()) out.add(`${plan}/${seat === "all" ? "*" : seat}`);
    } else if (token === "swarm") {
      out.add(`${senderPlan}/*`);
    } else if (token === "all") {
      continue;
    } else if (isCodeShaped(token) && plansOfCode(token, plans).length) {
      for (const plan of plansOfCode(token, plans)) out.add(`${plan}/*`);
    } else {
      out.add(`${senderPlan}/${token}`);
    }
  }
  return [...out];
}

const editDistance = (a: string, b: string): number => {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row.push(Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
    prev = row;
  }
  return prev[b.length];
};

/**
 * The `@…` tokens of a body that name no member (D63), each with the closest members, at most
 * three, as `<plan>/<seat>`. A member is an active member (`names`, as `parseMentions` takes it)
 * or the orchestrator of an open plan; `@swarm`, `@<plan>/all` and a funny name always match.
 * `@all` never does, its closest `swarm`; a two-letter token naming neither an open plan's code
 * nor a member gets the open plans' codes as its closest.
 */
export function unmatchedMentions(body: string, senderPlan: string, plans: string[], names?: ReadonlyMap<string, string>): { name: string; closest: string[] }[] {
  const handleOf = new Map([...(names ?? new Map<string, string>())].map(([handle, member]) => [member, handle]));
  const members = new Set([...handleOf.keys(), ...[senderPlan, ...plans].map((p) => `${p}/orchestrator`)]);
  const out: { name: string; closest: string[] }[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(MENTION)) {
    const token = m[1].replace(/[.\-]+$/, "");
    if (seen.has(token)) continue;
    seen.add(token);
    if (names?.has(token.toLowerCase())) continue;
    if (token === "all") {
      out.push({ name: token, closest: ["swarm"] });
      continue;
    }
    const targets = parseMentions(`@${token}`, senderPlan, plans, names);
    if (targets.length && targets.every((t) => t.endsWith("/*") || members.has(t))) continue;
    if (isCodeShaped(token)) {
      const codes = [...new Set(plans.map(planCode))];
      out.push({ name: token, closest: codes.sort((a, b) => editDistance(token.toUpperCase(), a) - editDistance(token.toUpperCase(), b)).slice(0, 3) });
      continue;
    }
    const wanted = token.split(/[/·]/).pop()!.toLowerCase();
    const gap = (member: string): number =>
      Math.min(editDistance(wanted, member.slice(member.lastIndexOf("/") + 1).toLowerCase()), editDistance(wanted, handleOf.get(member) ?? member));
    out.push({ name: token, closest: [...members].sort((a, b) => gap(a) - gap(b)).slice(0, 3) });
  }
  return out;
}
