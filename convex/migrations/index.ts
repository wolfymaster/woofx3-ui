import { Migrations } from "@convex-dev/migrations";
import { components } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";

/**
 * Tracked, batched and resumable data migrations. Define each one with
 * `migrations.define` in its own file under `convex/migrations/`, then run it
 * by function name:
 *
 *   bunx convex run migrations/index:run '{"fn": "migrations/<file>:<name>"}'
 */
export const migrations = new Migrations<DataModel>(components.migrations);

export const run = migrations.runner();
