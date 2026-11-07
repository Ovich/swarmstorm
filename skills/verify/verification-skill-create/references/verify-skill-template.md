# The shape of `verify-<app>-<focus>/SKILL.md`

Short, as a proven project skill is: an agent arriving cold reads it in a minute and works. Angle brackets are filled from the repository; the sentences outside them are carried as written. When the project already has a skill that runs the app, **Run the app** names it and restates none of it.

```markdown
---
name: verify-<app>-<focus>
description: Use when an orchestrator's brief or the person asks for a <focus> verification pass, and when what was delivered in <app> must be judged, <the focus: what is judged and through what>, for product quality by the agent alone, before a person sees it (done as specified, usable, finished). Produces the verdict and its findings table, returned to whoever asked. Not for code quality or tests.
---

# Verify <app>: <focus>

<The role prompt, written as `role-prompt.md` says: you are <app>'s quality owner and the owner of this skill, who the consumer is and what they come for, each expert role and what it answers for, in the product's terms.> You decide alone whether it is done as specified, usable without help, and finished. **You judge the product as its consumer meets it, never its code: you do not open the source to decide anything.** When this skill or a state it starts from no longer matches the app, you fix them in place, in the same run.

## Run the app

<The project skill that runs the app, named, its steps not restated; else what runs and how to see it, how to start only what is down, the ready signal, who may start and stop it, how the browser or client the agent acts in is opened.>

## Scope and inputs

**A pass judges the scope it is given, and only that**: the orchestrator's brief or the person names it (what was delivered, the range, the parts), and what lies outside is not walked, judged or reported. **A pass names its inputs and judges against them**, each given in the scope or taken from its default here: <the inputs of this focus, each with its default; for example the services the app runs against (real or mocked, which model), the starting state, the data fed in, the reference each part is judged against (a specification; the `design-prototype` skill's prototype, with the fidelity to hold: the experience, the layout, or a pixel match)>. An input neither given nor defaulted is asked for, never guessed. Content that varies with the inputs (what a real service returns) is judged for its shape and quality, never for matching a reference's example word for word. A result whose rightness depends on data the inputs do not settle (an empty answer, a count) is a question with its evidence, never a finding. The inputs open the report.

## Look

<The tool the agent acts through and its main calls.> A part it does not reach: find the way through the product itself, never the source, and write the way into this skill.

## Judge

The scope's reference: its inputs, else <where the specification lives>. Judge each part on three counts: done as specified, usable, finished. A finding names the role that saw it, where it is, what is there, what was expected and by which source, and its weight: blocker, major or minor. The verdict is `ready` with no blocker or major standing, else `not ready`. **The report is one message to whoever asked**, never a document: on the swarm board a post to `@orchestrator`, in a dispatch the subagent's return, to the person in chat. The inputs, the verdict, then one table, `# · weight · where · what · expected (source) · seen by`, as the `orchestrate` skill's `references/findings.md` shapes it: ids kept from the last judged table, the evidence in its cells, in words a reader without the app can follow.

<The project's own sections, as they are.>
```
