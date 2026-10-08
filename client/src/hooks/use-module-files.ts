import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { ModuleFileContent, ModuleFileList } from "@woofx3/api/api";
import { useAction } from "convex/react";
import { useCallback, useRef, useState } from "react";
import { useEngineCapabilities } from "@/hooks/use-engine-capabilities";
import { actionErrorMessage } from "@/lib/action-error";
import type { CapabilitySupport } from "@/lib/engine-capabilities";

export type ModuleFileListState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; list: ModuleFileList }
  | { status: "error"; message: string };

export type ModuleFileState =
  | { status: "loading" }
  | { status: "ready"; file: ModuleFileContent }
  | { status: "error"; message: string };

export interface ModuleFiles {
  /**
   * Whether the files can be browsed. An installed module's files come from
   * its engine, which needs `modules.files`; a marketplace module's come from
   * its archive and always can.
   */
  support: CapabilitySupport;
  retrySupport: () => void;
  list: ModuleFileListState;
  /** Fetches the file list unless it is loaded or loading. */
  loadList: () => void;
  file: (path: string) => ModuleFileState | undefined;
  /** Fetches one file unless it is loaded or loading; a failed one is fetched again. */
  loadFile: (path: string) => void;
}

interface LoadedFiles {
  key: string | null;
  list: ModuleFileListState;
  files: ReadonlyMap<string, ModuleFileState>;
}

const NO_FILES: ReadonlyMap<string, ModuleFileState> = new Map();

function emptyLoaded(key: string | null): LoadedFiles {
  return { key, list: { status: "idle" }, files: NO_FILES };
}

interface UseModuleFilesArgs {
  instanceId: Id<"instances"> | undefined;
  /** What getModuleDetail identified the module by; the actions resolve installed vs marketplace from it. */
  moduleId: string | undefined;
  isInstalled: boolean;
  version: string;
}

/**
 * A module's files and the contents of those opened, fetched on demand and
 * kept for as long as the same module version stays on screen.
 */
export function useModuleFiles({ instanceId, moduleId, isInstalled, version }: UseModuleFilesArgs): ModuleFiles {
  const listAction = useAction(api.moduleFiles.listModuleFiles);
  const readAction = useAction(api.moduleFiles.readModuleFile);
  const capabilities = useEngineCapabilities(isInstalled ? instanceId : undefined);

  const key = instanceId && moduleId ? `${instanceId}|${moduleId}|${isInstalled}|${version}` : null;
  // Stamped with the module it belongs to, so switching modules shows nothing
  // stale and a late response for the previous module is dropped.
  const [loaded, setLoaded] = useState<LoadedFiles>(() => emptyLoaded(key));
  // Requests started per module, so a repeat call does not fetch twice. A
  // failed request is removed so it can be tried again.
  const requested = useRef(new Set<string>());

  const current = loaded.key === key ? loaded : emptyLoaded(key);
  const support: CapabilitySupport = isInstalled ? capabilities.support("modules.files") : "supported";

  const update = useCallback((forKey: string, change: (state: LoadedFiles) => LoadedFiles) => {
    setLoaded((prev) => change(prev.key === forKey ? prev : emptyLoaded(forKey)));
  }, []);

  const loadList = useCallback(() => {
    if (!key || !instanceId || !moduleId || support !== "supported") {
      return;
    }
    const requestId = `${key}#list`;
    if (requested.current.has(requestId)) {
      return;
    }
    requested.current.add(requestId);
    update(key, (state) => ({ ...state, list: { status: "loading" } }));
    listAction({ instanceId, moduleId }).then(
      (result) => {
        update(key, (state) => ({ ...state, list: { status: "ready", list: result } }));
      },
      (err: unknown) => {
        requested.current.delete(requestId);
        update(key, (state) => ({ ...state, list: { status: "error", message: actionErrorMessage(err) } }));
      }
    );
  }, [key, instanceId, moduleId, support, listAction, update]);

  const loadFile = useCallback(
    (path: string) => {
      if (!key || !instanceId || !moduleId || support !== "supported") {
        return;
      }
      const requestId = `${key}#file:${path}`;
      if (requested.current.has(requestId)) {
        return;
      }
      requested.current.add(requestId);
      const setFile = (state: ModuleFileState) => {
        update(key, (prev) => ({ ...prev, files: new Map(prev.files).set(path, state) }));
      };
      setFile({ status: "loading" });
      readAction({ instanceId, moduleId, path }).then(
        (result) => {
          setFile({ status: "ready", file: result });
        },
        (err: unknown) => {
          requested.current.delete(requestId);
          setFile({ status: "error", message: actionErrorMessage(err) });
        }
      );
    },
    [key, instanceId, moduleId, support, readAction, update]
  );

  const currentFiles = current.files;
  const file = useCallback((path: string) => currentFiles.get(path), [currentFiles]);

  return { support, retrySupport: capabilities.refresh, list: current.list, loadList, file, loadFile };
}
