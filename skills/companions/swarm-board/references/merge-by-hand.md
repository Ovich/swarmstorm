# A merge by hand

The merge the `merge-lock` call of `references/worker.md` delivers by itself, step by step, for a
member the board gave no worktree: there the call takes the lock alone (as `merge-lock
--lock-only` does anywhere). The lock is held only to rebase, check and fast-forward: every
other worker waits on it. Never merge without the lock: `merged` refuses it.

0. **Before the lock**: commit, then run the task's done-when on your branch. What fails is
   fixed here, never under the lock.
1. `$S merge-lock --lock-only --onto <target>`. `held by …`: run the foreground `$S wait --mentions` in
   the foreground for its merged event, then run `merge-lock` again. `… is checked out at …`
   (exit 5): git would refuse the push; do what the answer says.
2. `git rebase <target>`.
3. A conflict in a file another worker changed: resolve it. You merge second; the resolution
   is yours, but the other worker hears of it: `merged` ends, for each such file, on `if you
   resolved a conflict in <file>, tell them: swarm post "@<them> I resolved <file>: <how>"
   --about <file>`. For each file you resolved, run that post with `<how>` filled in.
4. **Guides**: a grant that names `guides of this merge` lists the guides your changes fall
   under; check the change against each, then settle each in step 6.
5. Run the task's **quick check** on the rebased branch, then fast-forward `<target>` from your own
   worktree: `git -C <path> push . HEAD:<target>`, never forced. A refused push means `<target>` moved:
   rebase again.
6. `$S merged <sha> --report "<your report>"` (the files of the merge are read from your branch
   at the lock's grant, never typed), with
   `--guides` settling every guide the grant listed, in the form the grant's answer gives (refused otherwise): the
   report (step 7) rides on the merge, posted as `@orchestrator merged <sha>: <report>`, the
   orchestrator's one wake; a long report goes through `--report-file <path>` (a file's path given to
   `--report` is refused); `--report -` merges silently, recorded in the run only. After a
   change to an *interface* file, `$S post "@swarm <what changed in it>" --about <file>`.
   Your worktree stays for your next task; `end` removes it once clean and merged.
