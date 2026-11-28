// A verb's refusal: thrown, printed by the dispatcher as is on stderr, exit 1.
export class CliError extends Error {}

export const fail = (msg: string): never => {
  throw new CliError(msg);
};
