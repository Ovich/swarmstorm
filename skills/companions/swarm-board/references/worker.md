# The worker's side

You are one worker of a run that builds code (a task swarm, a plan run, a build-verify run): you
sit in your own worktree and do the tasks the orchestrator posts to you, one after another, for
as long as the run is open, while other workers do theirs beside you. `$S` is the tool, as
`SKILL.md` names it. Your brief names the run, your seat, the repository, and the branch your work
merges into, `<target>` below.

**End your turn only when you owe nothing**: your task merged and reported, or the phase done.
The board then shows you `away`, and the orchestrator resumes you by message with the next task;
never `end` while the run is open (it is refused). A turn ended while you owe work reads `lost`.
**Your only background tasks are your link and your listener.** A check, a test run or a build runs in
the foreground: an agent that ends its turn on a background task of its own is not woken by it.

## The loop

1. **Join, from the repository's checkout, before anything else**, the install included, so the
   roster shows you from the start:
   `$S join --run <run> --seat <your seat> --doing "waiting for a task" --as <group>/<seat>`. **The board names your
   worktree**, under the repository's git dir (`swarm/worktrees/<run>/<seat>`), never in its tree, on a branch of its own from `<target>`, and makes it
   at the join (the install runs there after that), or gives you back the one your seat already has; its answer prints the path. **That path is where you work**:
   every file by its absolute path under it, every git command as `git -C <path>`, the install
   run there; never `cd` into it (a shell parked in it keeps the folder from being removed), and
   every `$S` call carries `--as`. Read the roster it prints: who is there, doing what, holding
   which files, and your funny name. **It lists the project's architecture guides once**: load each
   skill whose files your task touches before you edit them.
2. **Start your link, then your listener, as your first two background tasks.** After the
   roster, `join` prints `start your link now, in the background …`: run that command, as
   printed, as a background task (the harness's own background feature; `references/setup.md`
   says which harnesses have one). It carries your calls to the board while you work, and is how the board sees
   you working. Any later answer that prints the same line means your link is down (after a resume, always):
   start it again before anything else. `join`
   shows, in full, any post for you made before you joined. With such a task, it ends on `start
   your listener now, in the background …`: run it the same way and start the task; with
   nothing for you, it ends on the foreground wait of step 3. `post` and `doing` end on
   the listener line while no listener of yours is pending: start it then.
3. **Wait for a task**: `$S wait --mentions`, in the **foreground**, with no timeout or one under
   your shell call's own limit. A task is a post to you (the `orchestrate` skill's
   `references/tasks.md` shapes it): its goal, contract, files, done-when. It returns empty: run it
   again (it holds 170 s and returns empty on purpose: a re-arm). Never sleep. Something unclear: ask `@orchestrator` before
   you start, then wait for the answer.
4. **Do it**, as your agent's definition says, `$S doing "<the task>"` first. **You claim
   nothing**: your link reads your worktree's changes from git every 2 s and the board holds
   exactly those files, until `merged` releases them (*Sharing a file*).
5. **A message for you arrives** (your listener's output, or a message the orchestrator sends you
   directly): act on it, answer on the thread if it asks (`$S post "@<them> …" --about <path>`; a
   message ending on `swarm agree …` is answered with that agreement, *Sharing a file*), then go
   on. A listener's first line is the command that re-arms it: run it again in the background;
   `superseded by a newer wait`: a foreground wait of yours took over, ignore it.
6. **Merge, at the task's end**, and early when a file your task marks *interface* changed in a way
   other tasks import. Nothing changed: no merge. Never merge without the lock: `merged` refuses it.
   **The lock is held only to rebase, check and fast-forward**: every other worker waits on it.
   0. **Before the lock**: commit, then run the task's full done-when (the full suite included) on
      your branch. A suite that fails is fixed here, never under the lock.
   1. `$S merge-lock --onto <target>`. `held by …`: run the foreground `$S wait --mentions` in
      the foreground for its merged event, then run `merge-lock` again. `… is checked out at …`
      (exit 5): git would refuse the push; do what the answer says.
   2. `git rebase <target>`.
   3. A conflict in a file another worker changed: resolve it. You merge second; the resolution
      is yours, but the other worker hears of it: `merged` ends, for each such file, on `if you
      resolved a conflict in <file>, tell them: swarm post "@<them> I resolved <file>: <how>"
      --about <file>`. For each file you resolved, run that post with `<how>` filled in.
   4. **Guides**: a grant that names `guides of this merge` lists the guides your changes fall
      under; check the change against each, then settle each in step 6.
   5. Run the task's **quick check** on the rebased branch (the tests covering the files you
      touched, never the full suite again), then fast-forward `<target>` from your own
      worktree: `git -C <path> push . HEAD:<target>`, never forced. A refused push means `<target>` moved:
      rebase again.
   6. `$S merged <sha> --files <every path the merge changed> --report "<your report>"`, with
      `--guides` settling every guide the grant listed, in the form the grant's answer gives (refused otherwise): the
      report (step 7) rides on the merge, posted as `@orchestrator merged <sha>: <report>`, the
      orchestrator's one wake; a long report goes through `--report-file <path>` (a file's path given to
      `--report` is refused); `--report -` merges silently, recorded in the run only. After a
      change to an *interface* file, `$S post "@swarm <what changed in it>" --about <file>`.
      Your worktree stays for your next task; `end` removes it once clean and merged.
7. **Report**: what your agent's definition says, given as `merged --report`, never a separate
   post after the merge; a task that merged nothing reports in one post to `@orchestrator`
   (`post --file` for a long one). A fix task reports per finding id what changed. Then back to 3.
8. **The run closes** (the closed line): `$S end`, then return one line per task you did. `end`
   refuses while your worktree holds work not merged, naming it and the merge; once it ends, it
   removes the worktree. It releases your files and the lock, and makes
   your listener return empty: do not re-arm it. A task that stops on a finding posts it first:
   `$S post "@orchestrator <the finding>"`, then waits.

## Phases

**Under a protocol, the board's current phase heads what you read**, its text saying every seat's
part: work the phase it names, never one you remember. A phase that posts you a task: do it as
above, then `$S done <phase>` once it is merged. A phase that gives you no part (verify, for a
builder): stay on call, answer a verifier's question on the thread, change nothing, `$S done
<phase>` at once. **Never start or stop the product the verifiers walk**: a task whose done-when asks to see your
change running serves your own build on the spare port the task names, stopped right after; any
other check asks a verifier on the thread. What you start, stop or sign in to follows
`references/machine.md`. **A pause**: the board's answer says to stop and wait; do only that until the resume.

## Along the way

- **One command per shell call**: absolute paths into your worktree, no `cd … &&`, no pipes into
  xargs, no `$(…)`; `git -C <path>` instead of cd.
- **`$S doing "<text>"`** at each step another worker would want to know: the module you are
  in, a test going green, a merge coming.
- **A mention that asks you something is answered before you go on.**
- **`$S roster`** for who holds what now.
- **A merged event that mentions you**: commit what you have, `git rebase <its sha>`, go on.
- **One wait at a time:** each new `wait` of yours supersedes the one before.
- **No background notification in your harness**: a foreground `$S wait --mentions --timeout <ms>`
  between steps, and whenever you have nothing else to do.

## Sharing a file

**A shared file is settled by one agreement.** When your changes and another worker's touch the
same file, the board posts it once to you both (`overlap: …`), ending on the `agree` line to run:
run it, saying who changes which part, in what order. The agreement goes for you both, and corrects work already
started; to change it, agree again. With no `@<seat>` in it, `--with <seat>` names the other party, so its merge reaches them; an agreement with no other party is refused.
