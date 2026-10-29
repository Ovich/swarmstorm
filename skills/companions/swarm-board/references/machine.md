# The shared machine

Read this before you start, stop or sign in to anything that outlives your call: a server, a
browser, a database, an account. The machine is shared: by the other members of your run, by
other runs (two swarms can work on one machine at once), and by the person. What you kill, sign
into or leave running reaches all of them.

## The four rules

1. **Stop only what you started, by its PID.** Keep the PID of every process you start, and stop
   it by that PID (`taskkill /PID <pid> /T /F`, `kill <pid>`). Never kill by name or pattern
   (`taskkill /IM`, `pkill`, `killall`, `Stop-Process -Name`, a kill fed by a process list
   filtered on its command line): the filter matches other members' test runs and servers.
   **Whatever listens on port `<n>` is yours to stop only while you hold `port:<n>`.** On some
   platforms a dev server leaves listeners outside the tree you started, so freeing your own port
   can take more than your PID; the lock is what makes those listeners yours.
2. **Never act as the person**: not their account, not their browser or its profile, not their
   live data. Work on a copy of the data, with a profile and an account of your own.
3. **Lock a shared resource before you use it**, by its name:

   | name | for |
   |---|---|
   | `port:<n>` | a port you serve on, or whose listeners you stop |
   | `app:<name>` | a running product others walk or test |
   | `db:<name>` | a database or data folder others read |
   | `browser:<profile>` | a browser profile |

4. **Stop what you started before you report.** A report is done when nothing you started is
   still running, unless the task tells you to keep it up.

## Locks

`$S lock <name> [--note "<what for>"]` takes it. The answer either grants it or names its holder:
the funny name, run code, state, since when, and what it is doing. Then the answer's `next:` line
says how to wait for it. While you wait, the board shows you `waiting · lock <name>, held by …`.
That is a wait, not a stall, even if you owe a phase. A grant of `port:<n>` lists the PIDs
listening on `<n>` now, and its `next:` line is the exact stop line for each. It reads in one of
three ways:

| the grant | means |
|---|---|
| plain, no listener | the port is free |
| `left running by <holder>'s release` | it started before the last release: stop it only if it is yours to stop |
| `started by someone without the lock` | it started after the release: ask on the board before you stop it |

`$S unlock <name>` releases it. `end`, a `lost` holder and the run's `close` release it too, and each release wakes the waiters. `status` and `roster` list the held
locks with their holder, since and waiters.

The locks are store-wide, because a port belongs to the machine and not to one repository. They
are honoured, not enforced: a member that never calls `lock` is seen only when it kills.

## What the orchestrator sees

The link reads each command you run. A kill by name or pattern, or a port kill without that
port's lock, reaches your orchestrator at once as `breach <member>: <command>`, with the move it
asks for. A lock that others wait on and that is held too long, or held by a member that is not
working, reaches the orchestrators of both runs as `stalled · lock`.
