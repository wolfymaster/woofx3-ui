import { z } from "zod";
import type { ParseResult } from "../notifications";

/**
 * Parses a request body with a contract schema. The answer carries one
 * message, the way the handler reports it in its 400: an unknown field
 * comes first, then the first schema issue in field order.
 */
export function parseRequestBody<Schema extends z.ZodTypeAny>(
  schema: Schema,
  body: unknown
): ParseResult<z.output<Schema>> {
  const result = schema.safeParse(body);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  const issues = result.error.issues;
  const unknownField = issues.find((issue) => issue.code === z.ZodIssueCode.unrecognized_keys);
  if (unknownField?.code === z.ZodIssueCode.unrecognized_keys) {
    return { ok: false, message: `Unknown field "${unknownField.keys[0]}"` };
  }
  const first = issues[0];
  if (first === undefined || (first.path.length === 0 && first.code === z.ZodIssueCode.invalid_type)) {
    return { ok: false, message: "body must be a JSON object" };
  }
  return { ok: false, message: first.message };
}
