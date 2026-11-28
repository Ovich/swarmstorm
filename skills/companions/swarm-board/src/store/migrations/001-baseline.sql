CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY,
  repo TEXT NOT NULL,
  plan TEXT NOT NULL,
  title TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open',
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  link TEXT,
  -- what kind of work a run is (D25)
  kind TEXT NOT NULL DEFAULT 'plan',
  -- 1 once the run's stale event is in main; any member call resets it (D19)
  stale_flagged INTEGER NOT NULL DEFAULT 0,
  -- set when prune removed the run's contents; the row stays so its id is never reused (D61): never listed
  pruned_at TEXT,
  -- the run's current phase, set by 'phase': its name and its text; null until one is opened
  phase TEXT,
  phase_text TEXT,
  -- set by pause, the orchestrator's reason; null when the run is not paused
  paused TEXT,
  -- when resume last lifted a pause: the stall check counts silence from it, never through the pause
  resumed_at TEXT,
  -- the run's stall threshold, and the stalled events posted since a counter last moved
  stall_ms INTEGER NOT NULL DEFAULT 600000,
  protocol TEXT,
  -- board-split#D28: the roles the run's orchestrator holds, a JSON array
  authority TEXT,
  -- the branch a run's members start from, recorded at open (its pack reads it)
  base TEXT,
  stall_posts INTEGER NOT NULL DEFAULT 0,
  -- idea 2: a pause waiting on the person; the current phase's watched members (JSON ids); the phase a member was last shown
  paused_person INTEGER NOT NULL DEFAULT 0,
  phase_watch TEXT,
  -- the seats the current phase is for ('phase --for', JSON ids); null: every member
  phase_for TEXT,
  -- board-split D49: when the current phase opened; a member owes it, and can stall on it, only from then
  phase_at TEXT
);
CREATE TABLE IF NOT EXISTS seats (
  run INTEGER NOT NULL,
  id TEXT NOT NULL,
  role TEXT,
  area TEXT,
  blockers TEXT NOT NULL DEFAULT '[]',
  state TEXT NOT NULL DEFAULT 'ready',
  ord INTEGER NOT NULL,
  link TEXT,
  PRIMARY KEY (run, id)
);
CREATE TABLE IF NOT EXISTS participants (
  id INTEGER PRIMARY KEY,
  run INTEGER NOT NULL,
  seat TEXT NOT NULL,
  place TEXT,
  doing TEXT NOT NULL DEFAULT '',
  files TEXT NOT NULL DEFAULT '[]',
  since_seq INTEGER NOT NULL DEFAULT 0,
  joined_at TEXT NOT NULL,
  ended_at TEXT,
  last_call TEXT,
  calls INTEGER NOT NULL DEFAULT 0,
  waiting INTEGER NOT NULL DEFAULT 0,
  -- 1 while a 'wait --mentions' is pending: a listener, not a wait (D49)
  listening INTEGER NOT NULL DEFAULT 0,
  nick TEXT,
  -- the member's pack and verify setting, chosen at join (board-split#D11, D22); pack_chosen 0 on an
  -- orchestrator's row, read as its kind's default
  pack TEXT,
  verify INTEGER NOT NULL DEFAULT 0,
  pack_chosen INTEGER NOT NULL DEFAULT 0,
  -- moved by every 'wait' start: a pending wait whose number is no longer this one is superseded (D64)
  wait_gen INTEGER NOT NULL DEFAULT 0,
  -- 1 once an orchestrator's quiet event is posted; its next call posts back and resets it (D15)
  -- the member's last post, done or doing (swarm-relay D36)
  progress_at TEXT,
  -- board-split D49: the member's last board call that is not a self-report (a post, 'doing', an endorsement): what a
  -- stall is measured from out of a wait
  board_call_at TEXT,
  quiet_flagged INTEGER NOT NULL DEFAULT 0,
  -- simple-states: whether the member owed the open phase when its link dropped (1/0); null while its link is up
  dropped_owing INTEGER,
  -- board-fixes#D5: when the member's doing text was set, and the last seq then; null on an orchestrator's row
  doing_at TEXT,
  doing_seq INTEGER,
  phase_shown TEXT,
  -- the member's 'wait --mentions' that returned empty on their hold, in a row: two while it owes nothing make it idle
  empty_waits INTEGER NOT NULL DEFAULT 0,
  idle_ended INTEGER NOT NULL DEFAULT 0,
  -- S22 (board-split D25): when the seat's current member joined, a re-join included; joined_at keeps the seat's first
  -- join. Null on a first join: read as joined_at
  seated_at TEXT,
  UNIQUE (run, seat)
);
CREATE TABLE IF NOT EXISTS messages (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  repo TEXT NOT NULL,
  author INTEGER NOT NULL,
  body TEXT NOT NULL,
  about TEXT,
  kind TEXT NOT NULL DEFAULT 'msg',
  mentions TEXT NOT NULL DEFAULT '[]',
  at TEXT NOT NULL,
  -- 1: written by the board itself in a member's name (a pack's notice), never a member's own word
  by_board INTEGER NOT NULL DEFAULT 0,
  -- a board event's data beside its text (D11)
  meta TEXT,
  -- a message's run (D31, plan D13): its author's run
  run INTEGER,
  endorses INTEGER,
  -- the board event a message is (D59); null on plain posts
  event TEXT,
  -- board-fixes#D13: 1 on an orchestrator's task to one seat; the seats it waits on ('--after', JSON), null for none
  task INTEGER NOT NULL DEFAULT 0,
  after TEXT
);
CREATE INDEX IF NOT EXISTS messages_repo ON messages (repo, seq);
CREATE TABLE IF NOT EXISTS deliveries (
  participant INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  -- board-split D54: when a message was delivered to its member, so a task's owing clock starts at its delivery
  at TEXT,
  PRIMARY KEY (participant, seq)
);
-- a version per project, moved by every write: what onChange compares (D39)
CREATE TABLE IF NOT EXISTS changes (
  repo TEXT PRIMARY KEY,
  version INTEGER NOT NULL
);
-- one row per counted call, written by countCall in the verb's transaction (D25); deleted with its run
CREATE TABLE IF NOT EXISTS call_log (participant INTEGER NOT NULL, at TEXT NOT NULL, verb TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS call_log_by_participant ON call_log (participant, at);
-- the board's own settings: last-upkeep (D16)
CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY, value TEXT NOT NULL);
-- a member done with a phase, once per run, member and phase; a phase opened again clears its rows
CREATE TABLE IF NOT EXISTS phase_done (run INTEGER NOT NULL, participant INTEGER NOT NULL, phase TEXT NOT NULL, at TEXT NOT NULL,
  PRIMARY KEY (run, participant, phase));
-- a member's transcript (member: its seat id, or orchestrator) and where its token counter stands
CREATE TABLE IF NOT EXISTS transcripts (run INTEGER NOT NULL, member TEXT NOT NULL, path TEXT NOT NULL, adapter TEXT,
  offset INTEGER NOT NULL DEFAULT 0, tokens INTEGER NOT NULL DEFAULT 0, readable INTEGER NOT NULL DEFAULT 0,
  read_at TEXT, moved_at TEXT, PRIMARY KEY (run, member));
-- the poller's readings, pruned past READINGS_KEPT_MS
CREATE TABLE IF NOT EXISTS token_readings (run INTEGER NOT NULL, member TEXT NOT NULL, t TEXT NOT NULL, tokens INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS token_readings_by_run ON token_readings (run, t);
-- a liveness warning posted, once per member and condition (none, unreadable); a good read clears unreadable
CREATE TABLE IF NOT EXISTS liveness_warned (run INTEGER NOT NULL, member TEXT NOT NULL, cond TEXT NOT NULL, PRIMARY KEY (run, member, cond));
-- board-split D55: a member's lost or stalled episode: pending at its predicate's first tick, opened at the second
-- (its alarm), closed when the predicate is false (recovered), or at end
CREATE TABLE IF NOT EXISTS badge_episodes (run INTEGER NOT NULL, member TEXT NOT NULL, badge TEXT NOT NULL, pending_at INTEGER NOT NULL, opened_at INTEGER, closed_at INTEGER,
  -- board-split D55 (amended, U-F27): since when an open episode's predicate reads false, its close pending
  clearing_at INTEGER);
CREATE INDEX IF NOT EXISTS badge_episodes_open ON badge_episodes (run, member, badge, closed_at);
-- a member's latest activity, from its link's frames (swarm-relay D9);
CREATE TABLE IF NOT EXISTS member_activity (
  run INTEGER NOT NULL, member TEXT NOT NULL,
  grew_at INTEGER, tokens INTEGER NOT NULL DEFAULT 0, context INTEGER,
  open_tool TEXT, open_target TEXT, open_since INTEGER, last_tool TEXT,
  finished INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL,
  open_wait INTEGER NOT NULL DEFAULT 0,
  -- idea 1: the turn state, the last line, the awaited background task and the transcript's path, from the link
  in_turn INTEGER,
  last_line TEXT,
  bg_target TEXT,
  bg_since INTEGER,
  bg_grew_at INTEGER,
  transcript TEXT,
  -- board-split D45: the open call's and the background task's own description and whole command, for the card's line
  open_label TEXT,
  open_command TEXT,
  bg_label TEXT,
  bg_command TEXT,
  -- D4 (G16): the link's report of the member's background listener; null before the link reports it
  listener_running INTEGER,
  listener_ended_at INTEGER,
  PRIMARY KEY (run, member));
-- a member's link as the server last saw it: connected, else lost since lost_at (ms epoch); swarm-relay D37
CREATE TABLE IF NOT EXISTS member_links (
  run INTEGER NOT NULL, member TEXT NOT NULL, connected INTEGER NOT NULL, lost_at INTEGER,
  -- board-split D55: a link's last heartbeat and its drop cause
  seen_at INTEGER,
  cause TEXT,
  PRIMARY KEY (run, member));
-- board-split D55: the board server's own facts (server_up_at, ms epoch)
CREATE TABLE IF NOT EXISTS server_facts (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS messages_channel ON messages (repo, run, seq);
-- board-fixes#D14: a run's own messages read by run alone (a member's open task, its stale doing, the tasks awaiting it),
-- which messages_channel cannot serve without the repo: on a store of 16k messages each read was a full scan
CREATE INDEX IF NOT EXISTS messages_run ON messages (run, seq);
