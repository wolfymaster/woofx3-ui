import { EXPRESSION_FUNCTIONS } from "@woofx3/api/expression";

export interface ExpressionFunctionHelp {
  name: string;
  /** How the menu writes it, in words a streamer can read. */
  signature: string;
  description: string;
}

/** What the variable menu says about each function, in the order it lists them. */
export const EXPRESSION_FUNCTION_HELP: readonly ExpressionFunctionHelp[] = [
  { name: "add", signature: "add(a, b)", description: "Adds two or more numbers." },
  { name: "subtract", signature: "subtract(a, b)", description: "Takes b away from a." },
  { name: "multiply", signature: "multiply(a, b)", description: "Multiplies two or more numbers." },
  { name: "divide", signature: "divide(a, b)", description: "Divides a by b." },
  { name: "round", signature: "round(number, decimals)", description: "Rounds a number. Decimals are optional." },
  { name: "min", signature: "min(a, b)", description: "The smallest of two or more numbers." },
  { name: "max", signature: "max(a, b)", description: "The largest of two or more numbers." },
  { name: "random", signature: "random(min, max)", description: "A random whole number from min to max." },
  { name: "uppercase", signature: "uppercase(text)", description: "THE TEXT IN CAPITALS." },
  { name: "lowercase", signature: "lowercase(text)", description: "the text in small letters." },
];

export function isExpressionFunction(name: string): boolean {
  return Object.hasOwn(EXPRESSION_FUNCTIONS, name);
}
