/**
 * Which instance the UI is scoped to, given the membership list (undefined
 * while loading) and the id selected last session.
 *
 * `instance` is only ever a member of the list: the cached id when it is
 * still there, otherwise the first instance. `optimisticInstanceId` is the
 * cached id while the list is loading, so instance-scoped queries can start
 * before membership is known, and the confirmed id after.
 */
export function selectInstance<T extends { _id: string }>(
  instances: ReadonlyArray<T | null> | undefined,
  cachedId: string | null
): { instance: T | null; optimisticInstanceId: string | null } {
  if (instances === undefined) {
    return { instance: null, optimisticInstanceId: cachedId };
  }
  const members = instances.filter((candidate): candidate is T => candidate !== null);
  const instance =
    (cachedId ? members.find((candidate) => candidate._id === cachedId) : undefined) ?? members[0] ?? null;
  return { instance, optimisticInstanceId: instance?._id ?? null };
}
