# Harness: an MCP server

**The tool**: a real MCP client over the transport the server ships with (its documented stdio command, or its HTTP URL): the repository's own, a small script on the official SDK, or the MCP inspector's CLI mode. Never its handlers imported directly. Initialise, then list its tools, resources and prompts: the surface an agent gets.

**The starting state**: configuration and credentials exactly as its install documents, isolated from the person's.

**What to observe**: each response as the agent receives it (content blocks, `isError`, structured content); the outcome beyond it, read back through another tool or the system it acts on; its notifications; its stderr.

## The role prompt of this surface

The experts this surface needs, written into the role prompt (`role-prompt.md`) as they are here, in the product's terms:

- **An agent-experience expert, as the agent consuming it**: names and descriptions that say when to call a tool and what it does, errors that say what to change.
- **A senior tool designer**: results sized for a context window and shaped for acting on.

## Gotchas

- **A stdio server logging to stdout** breaks the protocol: a blocker.
- **Large results** may be cut by the client: judge the server's response, not the client's rendering.
