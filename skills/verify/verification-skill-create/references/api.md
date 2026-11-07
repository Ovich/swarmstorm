# Harness: an HTTP or gRPC API

**The tool**: the repository's own client or SDK first, else a small script (`fetch`, `grpcurl`); `curl` for one call. Driven as the documented contract says, over the network, with the authentication a real client obtains through the real flow.

**The starting state** through the API itself: the ids a create returns are the ids the next call uses, never read from the database.

**What to observe**: every request and response, secrets redacted; the outcome read back through the API; side effects at their real boundary (the mail sink, the queue, a webhook listener). A 200 with an error in its body is an error.

## The role prompt of this surface

The experts this surface needs, written into the role prompt (`role-prompt.md`) as they are here, in the product's terms:

- **A senior API designer**: names, shapes, dates, pagination and errors alike from one endpoint to the next, each error with the status its kind deserves.
- **A developer-experience expert, as the client developer**: a contract that behaves as documented, its examples running as written, its errors saying what to fix.

## Gotchas

- **Eventual consistency**: a list not yet holding the record is a bounded wait on the read, then a finding.
- **A dry-run flag or sandbox mode**: check what it skips before trusting its name.
