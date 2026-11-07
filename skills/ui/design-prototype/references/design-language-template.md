# <Project>: design language

_Extracted <YYYY-MM-DD> from the codebase; every claim cites its source file. Re-extract when tokens or the UI kit change._

## Tokens (cite: `<theme file>`)

```css
:root {
  --bg: …; --fg: …; --muted: …; --line: …; --panel: …;
  --accent: …; --accent-soft: …;
  --ok: …; --warn: …; --danger: …;
  --radius-sm: …; --radius: …; --radius-lg: …;
  --shadow: …;
  --font-sans: …; --font-mono: …;
}
@media (prefers-color-scheme: dark) { :root { … } }
```

## Type scale & rhythm (cite)
- Sizes: display / h1 / h2 / body / caption → …
- Weights used: …  · line-height: …
- Spacing steps actually used (4/8/12/16/24/32…): …
- Content width: …  · gutters: …

## UI libraries (cite `package.json` or the stack's equivalent)
| Library | Version | Role in the app | Primitives the prototype must reuse |
|---|---|---|---|
| shadcn/ui, spartan, MUI, Angular Material, Bootstrap, Tailwind, a design-system package | … | the kit, the utility layer, the icon set | Button, Dialog, Badge, Card, Table, their sizes and variants |

## Component vocabulary (cite each)
| Name | Purpose | Defined in | Variants / states |
|---|---|---|---|
| Pill | … | `components/custom/…` | … |
| StatusChip | … | … | … |
| … | | | |

## Layout patterns (cite the screens)
- App shell: …
- Page header: … (title, actions on the right?, breadcrumb?)
- List/grid of things: … (cards vs table; density; empty state shape)
- Forms & dialogs: … (dialog widths, footer buttons order, destructive placement)
- Where primary actions live: …

## States & feedback
- Loading: …  · Empty: …  · Error: …  · Disabled + reason: …
- Toasts / inline messages: …

## Voice
- Capitalization: …  · Button verbs: …  · Error phrasing: …  · Language(s): …

## Don't (things this codebase avoids)
- …

## Open questions for the design owner
- …
