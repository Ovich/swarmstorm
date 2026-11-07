#!/usr/bin/env node
// Domain availability for name suggestions, through the registries' RDAP endpoints.
//   node domains.mjs <name>... [--tld ch,com,io] [--json]
// One line per domain: available / registered / unknown (with the reason). Exit 0.
// RDAP answers 404 for a name the registry does not hold, 200 with the record for a
// registered one. The registry's server comes from IANA's bootstrap file (dns.json).
// Node 22.5 or later, nothing else.

const args = process.argv.slice(2);
const tldArg = args.includes("--tld") ? args[args.indexOf("--tld") + 1] : "ch,com";
const json = args.includes("--json");
const names = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--tld");
if (names.length === 0) {
  console.error("usage: node domains.mjs <name>... [--tld ch,com,io] [--json]");
  process.exit(2);
}
const tlds = tldArg.split(",").map((t) => t.trim().replace(/^\./, "")).filter(Boolean);
const slug = (n) => n.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");

const UA = "swarmstorm-roadmap/1.0 (domain availability check)";
// country TLDs IANA's file does not list, with the registry's own server (checked 2026-09)
const CC = { ch: "https://rdap.nic.ch", li: "https://rdap.nic.li", fr: "https://rdap.nic.fr", de: "https://rdap.denic.de", uk: "https://rdap.nominet.uk/uk" };
let bootstrap = null;
async function baseFor(tld) {
  if (CC[tld]) return CC[tld];
  if (!bootstrap) {
    const r = await fetch("https://data.iana.org/rdap/dns.json", { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15000) });
    bootstrap = await r.json();
  }
  const svc = bootstrap.services.find(([tlds]) => tlds.includes(tld));
  return svc ? svc[1].find((u) => u.startsWith("https://")) || svc[1][0] : null;
}
async function rdap(domain) {
  const tld = domain.replace(/^.*?\.(?=[a-z]+(\.[a-z]+)?$)/, "").split(".").pop();
  try {
    const base = await baseFor(tld);
    if (!base) return { status: "unknown", reason: `no RDAP server listed by IANA for .${tld}` };
    const r = await fetch(`${base.replace(/\/$/, "")}/domain/${domain}`, { redirect: "follow", headers: { accept: "application/rdap+json", "user-agent": UA }, signal: AbortSignal.timeout(15000) });
    if (r.status === 404) return { status: "available", reason: "no record at the registry" };
    if (r.ok) {
      const d = await r.json().catch(() => ({}));
      const ev = (d.events || []).find((e) => e.eventAction === "expiration");
      const exp = ev ? ev.eventDate.slice(0, 10) : null;
      const past = exp && exp < new Date().toISOString().slice(0, 10);
      return { status: "registered", reason: past ? `expired ${exp}, in the registry's grace period, may be released or renewed` : exp ? `expires ${exp}` : "record found" };
    }
    return { status: "unknown", reason: `rdap ${r.status} at ${base}` };
  } catch (e) {
    return { status: "unknown", reason: e.name === "TimeoutError" ? "timeout" : e.message };
  }
}

const rows = [];
for (const n of names) for (const t of tlds) {
  const domain = `${slug(n)}.${t}`;
  rows.push({ domain, ...(await rdap(domain)) });
}
if (json) console.log(JSON.stringify(rows, null, 2));
else for (const r of rows) console.log(`${r.status.padEnd(10)} ${r.domain}  ${r.reason}`);
