// Evocative random seeds — writers get "ember-hollow-583", not "x7f9q2".
const SEED_A = ['crimson', 'silver', 'ancient', 'misty', 'ember', 'frozen', 'verdant', 'golden', 'shattered', 'quiet', 'stormy', 'lunar'];
const SEED_B = ['vale', 'reach', 'expanse', 'shore', 'dominion', 'haven', 'frontier', 'tide', 'summit', 'hollow', 'steppe', 'march'];

export function randomSeed(): string {
  const a = SEED_A[Math.floor(Math.random() * SEED_A.length)];
  const b = SEED_B[Math.floor(Math.random() * SEED_B.length)];
  return `${a}-${b}-${100 + Math.floor(Math.random() * 900)}`;
}
