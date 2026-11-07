// Writes a workbench page: Basecoat, the JSON reader (`jsonTree`) and the `bench` loader inlined, the
// bench bar opening on the label, and the bridge from aiview's theme switch to Basecoat's `.dark`.
// The page holds no data: the loader reads the sidecar through aiview. The bench's own code sits
// between the `<!-- bench-code -->` markers, just before </body>.
//   node page.mjs <YYYY-MM-DD-<bench>.workbench.html> --label "<label>" [--replace]
// Refuses to overwrite, except --replace on a page carrying a bench-code block: the page is
// remade at the same path (same aiview id and link), that block kept verbatim.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--label");
const label = args[args.indexOf("--label") + 1];
if (!out || !args.includes("--label") || !label) {
  console.error('usage: node page.mjs <file.workbench.html> --label "<label>" [--replace]');
  process.exit(2);
}
if (!out.endsWith(".workbench.html")) {
  console.error(`page.mjs: ${out} must end in .workbench.html, so aiview files it as kind workbench`);
  process.exit(2);
}
const BENCH_CODE = /<!-- bench-code -->[\s\S]*?<!-- \/bench-code -->/;
const replace = args.includes("--replace");
let benchCode = `<!-- bench-code -->
<script>
  // ---- the bench: draws its views with the bench loader (bench.view, bench.run, …) ----
</script>
<!-- /bench-code -->`;
if (existsSync(out)) {
  const kept = replace && readFileSync(out, "utf8").match(BENCH_CODE);
  if (!kept) {
    console.error(replace
      ? `page.mjs: ${out} has no <!-- bench-code --> block; --replace remakes only a bench page`
      : `page.mjs: ${out} exists; change the bench, or remake its page with --replace`);
    process.exit(1);
  }
  benchCode = kept[0];
} else if (replace) {
  console.error(`page.mjs: ${out} does not exist; --replace remakes an existing page`);
  process.exit(1);
}

const assets = join(dirname(fileURLToPath(import.meta.url)), "../assets/basecoat");
// `<` escaped wherever text lands inside an element that a stray `</style>` or `</script>` would close.
const css = readFileSync(join(assets, "basecoat.min.css"), "utf8").replace(/<\/style/gi, "<\\/style");
const js = readFileSync(join(assets, "basecoat.min.js"), "utf8").replace(/<\/script/gi, "<\\/script");
const jsonTreeDir = join(assets, "../json-tree");
const treeCss = readFileSync(join(jsonTreeDir, "json-tree.css"), "utf8");
const treeJs = readFileSync(join(jsonTreeDir, "json-tree.js"), "utf8").replace(/<\/script/gi, "<\\/script");
const benchJs = readFileSync(join(assets, "../bench/bench.js"), "utf8").replace(/<\/script/gi, "<\\/script");
const text = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${text(label)}</title>
<style data-basecoat>${css}</style>
<style data-json-tree>${treeCss}</style>
<style data-identity>
  /* aiview's identity on Basecoat's variables, so the bench reads as part of the viewer:
     signal blue the one accent, cool greys, Inter at 13px. */
  :root {
    --radius: 8px;
    --background: #f6f7f9; --foreground: #161a22;
    --card: #ffffff; --card-foreground: #161a22; --popover: #ffffff; --popover-foreground: #161a22;
    --primary: #3355e0; --primary-foreground: #ffffff;
    --secondary: #eef0f3; --secondary-foreground: #161a22;
    --muted: #eef0f3; --muted-foreground: #5b6474;
    --accent: #e8edfd; --accent-foreground: #3355e0;
    --destructive: #c7354a; --border: #e1e4ea; --input: #e1e4ea; --ring: #3355e0;
    --sidebar: #fbfbfc; --sidebar-foreground: #161a22; --sidebar-primary: #3355e0; --sidebar-primary-foreground: #ffffff;
    --sidebar-accent: #e8edfd; --sidebar-accent-foreground: #3355e0; --sidebar-border: #e1e4ea; --sidebar-ring: #3355e0;
    --ok: #17865a; --warn: #b86e00; --danger: #c7354a;
    --font-sans: "Inter", "Segoe UI", system-ui, -apple-system, sans-serif;
    --default-font-family: var(--font-sans);
    --font-mono: "JetBrains Mono", "Cascadia Code", ui-monospace, monospace;
    --default-mono-font-family: var(--font-mono);
  }
  .dark {
    --background: #0f1218; --foreground: #e7eaf0;
    --card: #161a22; --card-foreground: #e7eaf0; --popover: #161a22; --popover-foreground: #e7eaf0;
    --primary: #6d86ff; --primary-foreground: #0f1218;
    --secondary: #1d222c; --secondary-foreground: #e7eaf0;
    --muted: #1d222c; --muted-foreground: #98a1b2;
    --accent: #1d2645; --accent-foreground: #6d86ff;
    --destructive: #f0687c; --border: #262c38; --input: #262c38; --ring: #6d86ff;
    --sidebar: #12151c; --sidebar-foreground: #e7eaf0; --sidebar-primary: #6d86ff; --sidebar-primary-foreground: #0f1218;
    --sidebar-accent: #1d2645; --sidebar-accent-foreground: #6d86ff; --sidebar-border: #262c38; --sidebar-ring: #6d86ff;
    --ok: #3cc28a; --warn: #e3a23b; --danger: #f0687c;
  }
</style>
<style>
  body { margin: 0; background: var(--background); color: var(--foreground);
    font: 13px/1.5 var(--font-sans); -webkit-font-smoothing: antialiased; }
  .bench-bar { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 12px;
    min-height: 44px; padding: 6px 20px; border-bottom: 1px solid var(--border); background: var(--card); }
  .bench-label { font-weight: 600; font-size: 13px; white-space: nowrap; }
  .bench-tools { display: flex; flex: 1; flex-wrap: wrap; align-items: center; gap: 8px; }
  .bench { padding: 16px; }
</style>
</head>
<body>
<header class="bench-bar" data-component="BenchBar">
  <span class="bench-label">${text(label)}</span>
  <div class="bench-tools" id="bench-tools"></div>
</header>
<main class="bench" id="bench"></main>
<script data-basecoat>${js}</script>
<script data-json-tree>${treeJs}</script>
<script data-bench>${benchJs}</script>
<script>
  // aiview forces its theme by rewriting the media query text, this one included, so the
  // page follows the viewer's switch as well as the machine's.
  const scheme = matchMedia("(prefers-color-scheme: dark)");
  const applyScheme = () => document.documentElement.classList.toggle("dark", scheme.matches);
  applyScheme();
  scheme.addEventListener("change", applyScheme);
</script>
${benchCode}
</body>
</html>
`;
writeFileSync(out, page);
console.log(`wrote ${out} (${Math.round(page.length / 1024)} KB)`);
