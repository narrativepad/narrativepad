// Human-friendly display names + avatar colours derived from an address. Pure and deterministic,
// so server and browser render the same name for the same identity.

const ADJ = [
  "Swift", "Lucky", "Brave", "Quiet", "Cosmic", "Golden", "Rapid", "Silent", "Bold", "Clever", "Frosty", "Neon",
  "Lunar", "Solar", "Mighty", "Gentle", "Wild", "Sly", "Happy", "Sharp", "Velvet", "Electric", "Atomic", "Crimson",
  "Azure", "Jade", "Ivory", "Onyx", "Amber", "Misty", "Stormy", "Sunny",
];
const ANIMAL = [
  "Otter", "Falcon", "Panda", "Lynx", "Fox", "Raven", "Tiger", "Koala", "Gecko", "Orca", "Heron", "Bison",
  "Llama", "Moose", "Badger", "Shark", "Owl", "Wolf", "Hare", "Crane", "Viper", "Mantis", "Puma", "Yak",
  "Dingo", "Lemur", "Narwhal", "Ibex", "Marten", "Quokka", "Tapir", "Walrus",
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function displayName(address: string): string {
  const h = hash(address);
  return `${ADJ[h % ADJ.length]} ${ANIMAL[(h >>> 5) % ANIMAL.length]} ${(h >>> 10) % 100}`;
}

/** Two hues for a gradient avatar. */
export function avatarHues(address: string): [number, number] {
  const h = hash(`avatar:${address}`);
  const a = h % 360;
  return [a, (a + 40 + ((h >>> 9) % 80)) % 360];
}
