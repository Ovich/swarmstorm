# Pending work: publish early, say what is missing

A card sits at the head of the document, above the title where the reader meets it
before the content, for each unit of work still running: its label, one line on what
it is doing, and how long it has been going. "This is incomplete, and here is what is
missing" has to arrive before someone reads to the end and draws conclusions from a
document with holes in it.

```sh
ID=$($A pending add "#37" --label "L4 Integration" \
       --note "what breaks around the change: callers, consumers, migrations" --json)
# the agent runs, you write its section into the document
$A pending done "#<id from the json above>"
```

Three properties. The row exists exactly while the work does, so finishing is deleting
and nothing accumulates. It lives in the index, never in the file: the file is the
deliverable, and a "still working" placeholder left in it is worse than no feature.
Nothing can tell the index that a process died, so after 30 minutes a card stops
claiming to be live and says "no news for 40m"; `pending clear <doc>` removes leftovers
from a session that never came back.

Close every card you open, including where the work fails or is abandoned. A card that
never closes is a document that lies about being unfinished.

Closing a card means the section it announced is written: the card disappears and the
content takes its place. Where that content came from an agent rather than from you,
say so in the document, since nothing else records that a section arrived by way of an
unattended worker.
