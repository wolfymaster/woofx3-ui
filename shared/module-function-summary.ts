/**
 * What the module detail view shows for each function a module ships. Built
 * from up to two sources, because neither has everything: the
 * `moduleFunctions` rows the engine registers (installed modules) or the
 * marketplace listing (not installed), plus the module's manifest `functions[]`,
 * which is the only place the module-relative file path (`functions/battle.js`)
 * appears. The engine's registration carries just a file name.
 */
export interface ModuleFunctionSummary {
  /** `{moduleId}:function:{manifestId}`; unique within a module, so it keys the row. */
  qualifiedName: string;
  /** Never empty: falls back to the manifest id, then `qualifiedName`. */
  name: string;
  /** Module-relative path when the manifest is readable, otherwise the registered file name. */
  file?: string;
  entryPoint?: string;
  runtime?: string;
}

interface ManifestFunction {
  id: string;
  name?: string;
  path?: string;
  entryPoint?: string;
  runtime?: string;
}

/** A registered `moduleFunctions` row, reduced to the fields the summary reads. */
export interface RegisteredFunction {
  qualifiedName: string;
  manifestId?: string;
  functionName: string;
  fileName: string;
  entryPoint: string;
  runtime: string;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function compact(summary: ModuleFunctionSummary): ModuleFunctionSummary {
  const result: ModuleFunctionSummary = { qualifiedName: summary.qualifiedName, name: summary.name };
  if (summary.file !== undefined) {
    result.file = summary.file;
  }
  if (summary.entryPoint !== undefined) {
    result.entryPoint = summary.entryPoint;
  }
  if (summary.runtime !== undefined) {
    result.runtime = summary.runtime;
  }
  return result;
}

/** The manifest's `functions[]` keyed by id, skipping entries without one. */
export function manifestFunctionsById(manifest: unknown): Map<string, ManifestFunction> {
  const byId = new Map<string, ManifestFunction>();
  if (!manifest || typeof manifest !== "object") {
    return byId;
  }
  const functions = (manifest as Record<string, unknown>).functions;
  if (!Array.isArray(functions)) {
    return byId;
  }
  for (const entry of functions) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const o = entry as Record<string, unknown>;
    const id = nonEmpty(o.id);
    if (!id) {
      continue;
    }
    byId.set(id, {
      id,
      name: nonEmpty(o.name),
      path: nonEmpty(o.path),
      entryPoint: nonEmpty(o.entryPoint),
      runtime: nonEmpty(o.runtime),
    });
  }
  return byId;
}

/**
 * Summaries for an installed module. The registered rows decide which
 * functions exist; the stored manifest, when present, supplies the path and
 * fills fields older registrations left blank.
 */
export function installedFunctionSummaries(rows: RegisteredFunction[], manifest: unknown): ModuleFunctionSummary[] {
  const declared = manifestFunctionsById(manifest);
  return rows.map((row) => {
    const manifestId = nonEmpty(row.manifestId);
    const fromManifest = manifestId ? declared.get(manifestId) : undefined;
    return compact({
      qualifiedName: row.qualifiedName,
      name: fromManifest?.name ?? nonEmpty(row.functionName) ?? manifestId ?? row.qualifiedName,
      file: fromManifest?.path ?? nonEmpty(row.fileName),
      entryPoint: nonEmpty(row.entryPoint) ?? fromManifest?.entryPoint,
      runtime: nonEmpty(row.runtime) ?? fromManifest?.runtime,
    });
  });
}

/**
 * Summaries for a module that is not installed. The archive manifest is
 * preferred because it carries the path and entry point; the marketplace
 * listing (id, name and runtime only) stands in when the archive could not be
 * read.
 */
export function marketplaceFunctionSummaries(
  moduleId: string,
  listed: unknown[],
  manifest: unknown
): ModuleFunctionSummary[] {
  const declared = [...manifestFunctionsById(manifest).values()];
  const source: ManifestFunction[] =
    declared.length > 0 ? declared : [...manifestFunctionsById({ functions: listed }).values()];
  return source.map((fn) =>
    compact({
      qualifiedName: `${moduleId}:function:${fn.id}`,
      name: fn.name ?? fn.id,
      file: fn.path,
      entryPoint: fn.entryPoint,
      runtime: fn.runtime,
    })
  );
}

/** `functions/battle.js → handle_chat_message`, or whichever half is known; null when neither is. */
export function functionLocation(fn: Pick<ModuleFunctionSummary, "file" | "entryPoint">): string | null {
  if (fn.file && fn.entryPoint) {
    return `${fn.file} → ${fn.entryPoint}`;
  }
  return fn.file ?? fn.entryPoint ?? null;
}
