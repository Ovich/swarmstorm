# JSON on a bench

Read when the bench shows JSON the project produced: a model request or reply, a stored
document, an event, a tool's input.

**JSON is shown as a tree that folds and unfolds node by node, never as a `<pre>` dump or as
a list of the page's own making.** The person reads the data as the project wrote it, opens
only the branch they care about, and sees at a glance how big each part is (a context sent to
a model is often mostly one key).

- Each object and array is a `<details>`: its key, its count (`{6}`, `[3]`) and its size in
  characters on the summary line. The top level starts open, the rest folded.
- Each primitive is its raw JSON (`JSON.stringify`), in full, wrapped: strings and numbers
  coloured by type so they read apart from keys.
- The colours are Basecoat's tokens, with the type colours redefined under `.dark`: the
  tree reads in light and in dark alike.
- A message whose content is a JSON string (a chat message, a tool's arguments) is parsed
  first and shown as the tree; text that is not JSON stays text.

## The reader

**Every page carries it**: `page.mjs` inlines `assets/json-tree/` (the `jsonTree` function and
its CSS), so a bench never writes or pastes its own. Every JSON shown on the page goes through it:

```js
container.append(jsonTree(value, { open: 1, label: "request" }));
```

**The toolbar comes with every tree, never without it**: Fold all, Unfold all, Unfold n levels with 2 by default,
Copy (the value as indented JSON). It sticks at the top of the tree while the tree scrolls.
A bench that needs another action on a tree adds it to `assets/json-tree/json-tree.js` here,
so every bench gets it.

## Where it goes

- **A model call** (a trace, a prompt view): the system prompt as text, folded under its file
  name; the message the node was sent as the tree; the tools it was offered and whether it
  answered in a response format, on one line under it.
- **A reply or a stored document**: the tree, the top level open.
- **Beside a rendering** (the document drawn as the product draws it): the tree under a
  "raw" fold, so the rendering leads and the data stays one click away.
