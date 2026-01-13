export function partition<T>(
  array: T[],
  predicate: (item: T) => boolean,
): [T[], T[]] {
  const trueItems: T[] = [];
  const falseItems: T[] = [];
  for (const item of array) {
    if (predicate(item)) {
      trueItems.push(item);
    } else {
      falseItems.push(item);
    }
  }
  return [trueItems, falseItems];
}

export function sortByArray<T>(
  arr: T[],
  fn: (item: T) => (number | string)[],
): T[] {
  const values = new Map(arr.map((x) => [x, fn(x)]));
  return arr.slice().sort((x, y) => {
    const a = values.get(x);
    const b = values.get(y);
    if (!a || !b) return 0;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const ai = a[i] ?? 0;
      const bi = b[i] ?? 0;
      if (ai < bi) return -1;
      if (ai > bi) return 1;
    }
    return 0;
  });
}

export function intersection<T>(xs: T[], ys: T[]): T[] {
  return xs.filter((x) => ys.includes(x));
}

export function difference<T>(xs: T[], ys: T[]): T[] {
  return xs.filter((x) => !ys.includes(x));
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

export function fisherYatesShuffle<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp: T = shuffled[i] as T;
    const swapItem: T = shuffled[j] as T;
    shuffled[i] = swapItem;
    shuffled[j] = temp;
  }
  return shuffled;
}
