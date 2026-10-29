# What the person sees

**Left, the sidebar.** Documents newest-activity first: a search field, kind chips (one
colour per kind, click to filter), tag chips (multi-select; the most recently active first, twelve shown and the rest behind "+ n more", a chosen one always in sight, the tab's project's own slug left out), grouped documents inside
collapsible containers (display title and member count, members in reading order),
ungrouped documents flat, missing files struck through. The tab's own project scopes the
list (there is no All projects); the selector at the top switches this tab only and sets where a
new tab opens. No agent verb moves a tab but `open` and `show`, on the agent's project. A project with news since the tab last visited it carries a dot.

**Right, the document.** Title, absolute local path (click to copy), kind, started,
tags, updated, then the rendered document: Markdown with GFM and mermaid, an HTML
prototype in a sandboxed frame, a PDF in the browser's viewer. Every save re-renders.
Above the content, one card per unit of work the document still waits on, appearing
and disappearing live (`pending`).

**A prototype's toolbar.** Three groups above the frame. *Viewport*: mobile 390, tablet
820, laptop 1280, full. *View*: Rendered is the page; Composition outlines every region
bound from another prototype in indigo, "pulled", with its source and component on hover
and a click opening that source at that component, every component the prototype offers
in green, "offered", and the rest of the page receding under a veil. In Composition
the page takes no mouse: it is looked at, not operated. *Variant*: the variants and
actions the prototype declares in its `PrototypeBar` (the `design-prototype` skill), mirrored
here; the in-page bar is hidden, the chosen variant persists across reloads.

**A workbench's toolbar.** Theme alone, the page at full width: a workbench is a tool
used at its size, so viewport and Composition are not offered, and the person's choices
for prototypes are kept for the next one.

**Pointing.** When the agent points at components of a prototype (`show`), one tab (the one on that project, else the last used) goes to
that prototype, switches to the variant named, scrolls to the first component and outlines
each one with its name, the rest of the page dimmed. The page still takes the mouse. A
chip in the toolbar says what is pointed at. Its cross stops it and takes the tab back
to what the person was reading before the agent pointed, as the agent's `show --done`
does; a tab the person has since moved is left where it is. The address bar
holds the pointer (`#doc=12&show=Strip,Menu&variant=step-2`), so the link can be kept.

**The board.** Board, first in the menu, is the page `#board&repo=<key>`: the tab's project's swarm
board, drawn by aiview itself from swarm's store, for the repositories the project's runs
were opened in: one tab per run, the phase strip, the conversation, the agents beside it,
the archive behind ☰. Switching the tab's project shows that project's board, in that tab alone. It follows aiview's theme and updates live as agents write; there is no second server
to start.

**Bindings.** An html prototype that pulls components from siblings (`data-bind`) is
composed at serve time; the file on disk never changes. Opened as a plain file it shows
a notice, not the page. Saving a source reloads every open host.
