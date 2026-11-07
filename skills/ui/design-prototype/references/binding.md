# Binding: components shared between prototypes

## Declaring a component

- **A region another prototype may want carries `data-component="Name"`** and styles itself under `[data-component="Name"]` and descendants, never through element or `body` rules.
- **Bindable means static.** A bindable component is markup in the file, never the output of the file's script; it carries no `id` and no inline handler.
- **Parts a script must reach are marked `data-part="name"`** and found inside the bound element; clicks are wired by delegation on `data-action`.

## Binding

- **Place `<div data-bind="file#Name"></div>` where the component goes**, `file` being the sibling's bare file name. aiview replaces the placeholder with the component, no wrapper, the placeholder's `class` and `style` merged on.
- **Bound copies are markup and style**: keep behaviour in the source prototype, or write it in the host against the bound markup. Editing the source reloads every open host.
- **Before writing a placeholder, run `aiview components <file>`** on the sibling: it lists names, tags, and the ids or inline handlers that would break a component once bound. Never grep a sibling for `data-component`.
- **After writing one, run `aiview check <host>`** and read the errors as text.
- **Components a host shows by script** (a dock of tools opened one at a time): keep their placeholders in a hidden container of the host and let the host's script clone the bound node's inner html when it needs it. A source that shows the same components in place moves them out of its library at load.
- **A bound prototype is seen through aiview.** Opened as a plain file it shows a notice; never hand one over as standalone HTML.

## Variants

- **Declare every state as a static button in one `<div data-component="PrototypeBar">`**: default, empty, loading, error, any permission or role state, the steps of a flow, the alternatives of a layout. `data-aiview-variant="name"` on each, `aria-pressed` on the one shown first; the prototype's script switches on a click of that button.
- **A plain button the person may press** (reset, toggle a warning) carries `data-aiview-action="name"` instead.
- **aiview hides the bar and mirrors both in its own toolbar**, which makes a variant reachable in Composition and keeps the chosen one across reloads. Buttons a script adds later are invisible to the viewer.

## Decomposition

**Propose a split in one line and wait**, when a region is drawn in two files or a prototype grows a second screen's worth of components: "the tools could live in their own prototype and be bound here, want that?". Never split a prototype on your own.
