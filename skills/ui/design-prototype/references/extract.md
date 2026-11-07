# Extracting the design language

**Extract, never guess. Read in this order and cite the file for every claim:**

| Look at | To learn |
|---|---|
| `package.json` (or the stack's equivalent): the UI libraries and their versions (shadcn, Radix, spartan, MUI, Angular Material, Bootstrap, Tailwind, a design system package) | which primitives the app already speaks, their sizes, radii, variants and names; the prototype uses those, never a look-alike of its own |
| Global CSS / theme file (`app.css`, `globals.css`, `theme.css`), Tailwind config | colour tokens (both themes), radii, shadows, font stacks, type scale, spacing rhythm |
| Generated UI kit folder (`components/ui/`) | which primitives exist (Button, Dialog, Badge, Card, Table) and their variants |
| Custom/wrapped components (`components/custom/`, `layout/`, `typography/`, `shell/`) | the project's named vocabulary: layout primitives, chips, pills, hints, state chips, dialogs, the words the codebase already uses for visual things |
| 2 to 3 representative existing screens (pages/routes) | page skeleton (shell, header, content width, section spacing), density, how lists, cards and tables are used, empty and loading states, where actions sit |
| Copy in those screens, `nomenclature.md`, `AGENTS.md` | tone, capitalisation, button verbs, how errors are phrased |
| Existing prototypes for this project (`aiview list --kind prototype --tag <project>`) | what has already been proposed and accepted or rejected |

- **Write it as the template in `design-language-template.md`, beside this file**: tokens (as CSS custom properties, light and dark), type scale, spacing, radius and shadow, the UI libraries with versions, component vocabulary (name, purpose, where defined), layout patterns, states and feedback, voice, and an explicit "don't" list. Only what a designer needs to draw a native screen.
- **Register it via the `aiview` skill**: kind `reference`, tags = design.
