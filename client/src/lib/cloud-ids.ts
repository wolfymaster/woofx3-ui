// Features only the cloud dashboard has are Convex functions keyed by Convex
// document ids: macros, which the dashboard keeps, and the installed-module
// list, which Convex records. Engine calls about those records take the
// gateway's own ids. Under the Convex gateway the two name the same
// documents, so these features convert between them here, and only here:
// nothing else outside client/src/engine may reach the Convex adapter's ids.

export { toMacroId, toModuleId } from "@/engine/convex/ids";
