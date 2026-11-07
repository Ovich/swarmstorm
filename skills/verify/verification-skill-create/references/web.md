# Harness: a web front end

**The tool**: a browser MCP the agent already has (the project's watched browser, Playwright MCP) before anything written: navigate, snapshot, click, type, resize, emulate the theme, screenshot, read the console and the network. With none, Playwright from the repository, headless, one fresh context per run, never the person's own browser. **An MCP that attaches to a running browser** (a CDP endpoint) **needs its launcher**: the browser started on that port with its own profile and the consumer signed in, one script in the skill that runs the app, as `tooling.md` says.

**The starting state** the way the consumer gets it, or the way the project's e2e support restores it (a seed onto a fresh person). Sign-in as the project's tests do it locally.

**What to observe**: the screen at each state, at the widths and themes the pass's inputs name (by default those the product supports); the outcome on the page the consumer would open next, never in the database; the console's errors and the failed requests; a reference prototype at the same width beside the app when the scope takes one. A page that scrolls inside its columns shows its fold only when the column is scrolled.

## The role prompt of this surface

The experts this surface needs, written into the role prompt (`role-prompt.md`) as they are here, in the product's terms:

- **A senior UI/UX expert**: every control says what it does, every action answers, every state is shown (empty, loading, error, a reload, the back button), every flow reads without help.
- **Its art director**: a product that looks like itself, deliberate and finished against its design language, at every width and in both themes, nothing clipped or overflowing, every motion settled.
- **Its accessibility specialist**: the keyboard alone, a screen reader, low vision, a narrow screen.

## Gotchas

- **A hot-reloading dev server** restarts mid-pass on any file write: write nothing into the repository during a pass.
- **Toasts** vanish on a timer: read them at once, or the state they announce.
