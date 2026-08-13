/** Compact unique-enough IDs for local rows (no crypto dependency needed). */
let counter = 0;

export function makeId(): string {
  counter = (counter + 1) % 46656; // 36^3
  return (
    Date.now().toString(36) +
    '-' +
    Math.random().toString(36).slice(2, 8) +
    '-' +
    counter.toString(36)
  );
}
