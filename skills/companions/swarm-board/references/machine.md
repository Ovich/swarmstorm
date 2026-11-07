# The shared machine

Read this before you start, stop or sign in to anything that outlives your call: a server, a
browser, a database, an account. The machine is shared: by the other members of your run, by
other runs (two swarms can work on one machine at once), and by the person. What you kill, sign
into or leave running reaches all of them.

## The four rules

1. **Stop only what you started, by its PID.** Keep the PID of every process you start, and stop
   it by that PID (`taskkill /PID <pid> /T /F`, `kill <pid>`). Never kill by name or pattern
   (`taskkill /IM`, `pkill`, `killall`, `Stop-Process -Name`, a kill fed by a process list
   filtered on its command line): the filter matches other members' test runs and servers. Never
   kill by port either: whatever listens on a port may be another member's.
2. **Never act as the person**: not their account, not their browser or its profile, not their
   live data. Work on a copy of the data, with a profile and an account of your own.
3. **Use a port, a running app, a database or a browser profile only as your brief gives it**:
   your own port range, your own instance, your own profile. Ask on the board before you use one
   another member may be using.
4. **Stop what you started before you report.** A report is done when nothing you started is
   still running, unless the task tells you to keep it up.

## What the orchestrator sees

The link reads each command you run. A kill by name, pattern or port reaches your orchestrator at
once as `breach <member>: <command>`, with the move it asks for.
