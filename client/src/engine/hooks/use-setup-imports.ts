import { useEngineGateway } from "@/engine/context";

/** The instance's most recent setup import with its items; null when it has none. */
export function useLatestSetupImport() {
  return useEngineGateway().setupImports.useLatest();
}

/** Reads an export into a report to review; nothing reaches the engine yet. */
export function useAnalyzeSetupImportRequest() {
  return useEngineGateway().setupImports.useAnalyzeRequest();
}

/** Starts creating a reviewed import's items on the engine. */
export function useStartSetupImportRequest() {
  return useEngineGateway().setupImports.useStartRequest();
}

/** Tries the items that needed a module or failed again. */
export function useRetrySetupImportRequest() {
  return useEngineGateway().setupImports.useRetryRequest();
}

/** Throws away an import still in review. */
export function useDiscardSetupImportRequest() {
  return useEngineGateway().setupImports.useDiscardRequest();
}
