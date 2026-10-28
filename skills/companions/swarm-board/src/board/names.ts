// A member's funny name (D43): an adjective and an animal, picked at random at join among
// those no active member of the repository carries.

const ADJECTIVES = [
  "Sleepy", "Grumpy", "Brave", "Clumsy", "Dizzy", "Fuzzy", "Gentle", "Hasty", "Jolly", "Lucky",
  "Mighty", "Nimble", "Plucky", "Quiet", "Rusty", "Sneaky", "Tidy", "Witty", "Zesty", "Bouncy",
  "Cheeky", "Dapper", "Eager", "Fancy", "Giddy", "Humble", "Lofty", "Merry", "Peppy", "Snappy",
];
const ANIMALS = [
  "Otter", "Badger", "Walrus", "Penguin", "Llama", "Ferret", "Puffin", "Wombat", "Gecko", "Moose",
  "Panda", "Lemur", "Narwhal", "Hedgehog", "Koala", "Yak", "Toucan", "Beaver", "Platypus", "Raccoon",
  "Alpaca", "Bison", "Capybara", "Dingo", "Emu", "Flamingo", "Gibbon", "Heron", "Ibis", "Jackal",
];

/** A name not in `taken` (compared without case); past the pool's 900, a number is added. */
export function funnyName(taken: Iterable<string>, random: () => number = Math.random): string {
  const used = new Set([...taken].map((t) => t.toLowerCase()));
  const pick = <T,>(xs: T[]): T => xs[Math.floor(random() * xs.length) % xs.length];
  const free = ADJECTIVES.flatMap((a) => ANIMALS.map((b) => `${a} ${b}`)).filter((n) => !used.has(n.toLowerCase()));
  if (free.length) return pick(free);
  for (let i = 2; ; i++) {
    const n = `${pick(ADJECTIVES)} ${pick(ANIMALS)} ${i}`;
    if (!used.has(n.toLowerCase())) return n;
  }
}
