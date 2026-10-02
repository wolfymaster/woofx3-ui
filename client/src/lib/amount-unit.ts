/**
 * Modules declare a field's `unit` in the plural ("bits", "subs", "months"), as it reads
 * beside most amounts. One of anything is singular, so the unit is made singular for an
 * amount of exactly 1.
 *
 * Only a last word that reads as an English plural changes. Abbreviations ("ms", "s")
 * and words that are not plurals ("class") are left alone, since a wrong guess reads
 * worse than "1 ms".
 */
export function unitFor(amount: number, unit: string): string {
  if (amount !== 1) {
    return unit;
  }
  const match = /^(.*?)([A-Za-z]{2,})$/.exec(unit);
  if (!match) {
    return unit;
  }
  const [, lead, word] = match;
  return `${lead}${singularWord(word)}`;
}

function singularWord(word: string): string {
  if (/[^aeiou]ies$/i.test(word)) {
    return `${word.slice(0, -3)}y`;
  }
  if (/(x|ch|sh|ss)es$/i.test(word)) {
    return word.slice(0, -2);
  }
  if (word.length >= 3 && /[^s]s$/i.test(word)) {
    return word.slice(0, -1);
  }
  return word;
}

/** An amount and its unit as they read together: "1 bit", "1,000 bits". */
export function formatAmount(amount: number, unit?: string): string {
  const text = amount.toLocaleString();
  return unit ? `${text} ${unitFor(amount, unit)}` : text;
}
