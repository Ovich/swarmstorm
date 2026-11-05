# Consolidate

1. **Compare, then stop.** A table: callers of each copy, behaviour differences found by reading both, test coverage of each, lines. Recommend the survivor and say what the loser does that the survivor does not. Stop for the person's yes.
2. **Characterize the differences** the survivor must absorb: one commit of tests pinning the loser's outputs where they differ, green on the old code. A difference the person rules a bug is noted, not pinned.
3. **Move the callers** to the survivor, the tests from step 2 unchanged.
4. **Delete the loser** as `references/path.md` says, its brief naming the loser's files.

A difference found after step 1 reopens step 1. A survivor grown to absorb the loser is a finding for the `deepen-module` skill, not a reason to keep both.
