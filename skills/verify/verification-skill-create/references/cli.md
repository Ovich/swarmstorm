# Harness: a command-line or terminal program

**The tool**: the built binary, as the consumer gets it, run in a fresh scratch directory with its own `HOME` and config, so nothing reads or writes the person's. A PTY (`node-pty`, `script`, the repository's helper) when the program needs a terminal; a pipe otherwise.

**The starting state**: the files it needs, created in that directory and nowhere else; arguments as the help or the README document them.

**What to observe**: the exit code, stdout and stderr apart, the terminal transcript; what the program did beyond its output (the files written, the state a second run reads back). A "done" line is checked against what it claims.

## The role prompt of this surface

The experts this surface needs, written into the role prompt (`role-prompt.md`) as they are here, in the product's terms:

- **A command-line UX expert, as the newcomer at a terminal**: help, errors and progress that get them through, what went wrong and what to type instead.
- **A seasoned scripter**: exit codes a script can rely on, output that parses in a pipe.

## Gotchas

- **Colour and width** differ between a PTY and a pipe: set `NO_COLOR` and a fixed `COLUMNS`, and say so.
- **Windows and POSIX**: line endings and separators; the document says which platform ran.
