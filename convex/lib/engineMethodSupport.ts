/**
 * True when an engine call failed because the engine does not offer `method`
 * at all, rather than because the method ran and failed.
 *
 * An engine older than the UI answers a call to a method it never declared
 * with capnweb's "'<method>' is not a function." TypeError, which reaches the
 * caller as its message. Telling the two apart lets a feature say "update the
 * engine" instead of reporting a failure the user cannot fix from here.
 */
export function isMissingEngineMethodError(message: string, method: string): boolean {
  const mentionsMethod = message.includes(method);
  if (!mentionsMethod) {
    return false;
  }
  return /is not a function|no such method|unknown method|method not found/i.test(message);
}
