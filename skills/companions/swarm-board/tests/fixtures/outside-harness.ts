// The suite runs outside a harness session (swarm-relay D39), even when started from inside one: a verb then starts a
// detached link as before, instead of waiting 10 s for an agent's own. A test of the harness case sets the variable itself.
delete process.env.CLAUDE_CODE_SESSION_ID;
// Every test home is a temporary one: printed commands stay bare, as the suite's patterns expect (G3 has its own test).
process.env.SWARMSTORM_PRINT_HOME = "0";
