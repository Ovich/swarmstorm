# Harness: a microservice or an event-driven service

**The tool**: the repository's own clients first, else the broker's CLI; the dependencies launched as the repository does (its compose file, its dev script, its local broker), never an in-memory stand-in.

**The starting state**: the messages a real producer would send, with their headers, key and schema version, one correlation id per journey.

**What to observe**: the messages out, from a fresh consumer group started before the action, filtered by the correlation id; the state through the service's own read surface; what must not be emitted, by its absence within a stated bound; the dead-letter topic.

## The role prompt of this surface

The experts this surface needs, written into the role prompt (`role-prompt.md`) as they are here, in the product's terms:

- **A senior integration architect, for the teams that consume it**: a contract kept, nothing that surprises a consumer.
- **Its on-call operator**: failures that land where the design says with enough to act on, and logs that follow one journey by its correlation id.

## Gotchas

- **At-least-once delivery**: a duplicate is a finding only when the design promised exactly-once.
- **Clock skew and retries** widen every bound; a one-second bound is an intermittent finding waiting to happen.
