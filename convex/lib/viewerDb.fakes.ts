import type { MutationCtx } from "../_generated/server";

// An in-memory stand-in for the slice of `ctx` the viewer sign-in functions
// use: equality index lookups, get, insert, patch, delete, and the scheduler.
// The second dot in the file name keeps Convex from deploying it.

type Row = Record<string, unknown> & { _id: string; _creationTime: number };

interface IndexRange {
  eq(field: string, value: unknown): IndexRange;
}

export interface FakeViewerCtx {
  ctx: MutationCtx;
  tables: Map<string, Row[]>;
  scheduled: { at: number; args: unknown }[];
  /** Overrides `ctx.auth.getUserIdentity`; null means nobody is signed in to Convex Auth. */
  identity: { subject: string } | null;
}

export function fakeViewerCtx(): FakeViewerCtx {
  const tables = new Map<string, Row[]>();
  const scheduled: { at: number; args: unknown }[] = [];
  let nextId = 0;
  const rows = (table: string): Row[] => {
    const existing = tables.get(table);
    if (existing) {
      return existing;
    }
    const created: Row[] = [];
    tables.set(table, created);
    return created;
  };
  const find = (id: string): { table: string; row: Row } | null => {
    for (const [table, list] of tables) {
      const row = list.find((candidate) => candidate._id === id);
      if (row) {
        return { table, row };
      }
    }
    return null;
  };

  const db = {
    query: (table: string) => ({
      withIndex: (_index: string, range: (q: IndexRange) => IndexRange) => {
        const conditions: [string, unknown][] = [];
        const q: IndexRange = {
          eq(field, value) {
            conditions.push([field, value]);
            return q;
          },
        };
        range(q);
        const matches = () => rows(table).filter((row) => conditions.every(([field, value]) => row[field] === value));
        return {
          unique: async () => {
            const found = matches();
            if (found.length > 1) {
              throw new Error(`unique() matched ${found.length} rows in ${table}`);
            }
            return found[0] ?? null;
          },
          first: async () => matches()[0] ?? null,
          take: async (n: number) => matches().slice(0, n),
        };
      },
    }),
    get: async (id: string) => find(id)?.row ?? null,
    insert: async (table: string, value: Record<string, unknown>) => {
      nextId += 1;
      const id = `${table}:${nextId}`;
      rows(table).push({ ...value, _id: id, _creationTime: nextId });
      return id;
    },
    patch: async (id: string, value: Record<string, unknown>) => {
      const found = find(id);
      if (!found) {
        throw new Error(`patch: no document ${id}`);
      }
      Object.assign(found.row, value);
    },
    delete: async (id: string) => {
      const found = find(id);
      if (!found) {
        throw new Error(`delete: no document ${id}`);
      }
      tables.set(
        found.table,
        rows(found.table).filter((row) => row._id !== id)
      );
    },
  };

  const fake: FakeViewerCtx = { ctx: undefined as unknown as MutationCtx, tables, scheduled, identity: null };
  fake.ctx = {
    db,
    auth: { getUserIdentity: async () => fake.identity },
    scheduler: {
      runAt: async (at: number, _fn: unknown, args: unknown) => {
        scheduled.push({ at, args });
      },
      runAfter: async (delay: number, _fn: unknown, args: unknown) => {
        scheduled.push({ at: delay, args });
      },
    },
  } as unknown as MutationCtx;
  return fake;
}

/** Inserts a row as a test fixture and returns its id, typed as the caller needs. */
export async function seed<T extends string>(
  fake: FakeViewerCtx,
  table: string,
  value: Record<string, unknown>
): Promise<T> {
  return (await fake.ctx.db.insert(table as never, value as never)) as unknown as T;
}
