// A run's stall window (simple-states), shared by the run that stores it and the members it is read against.
/** The default stall window of a run (simple-states: 10 min): a member whose tokens did not move this long reads
 *  stopped, and a swarm none of whose members moved is told stopped. */
export const STALL_MS_DEFAULT = 10 * 60 * 1000;
/** The stall window is never shorter, whatever a run stored (runs opened before keep an older default) or `open
 *  --stall-ms` asked. SWARM_STALL_FLOOR_MS: a scaled test scene lowers it; read at each use. */
export const stallMsFloor = (): number => Number(process.env.SWARM_STALL_FLOOR_MS) || STALL_MS_DEFAULT;
