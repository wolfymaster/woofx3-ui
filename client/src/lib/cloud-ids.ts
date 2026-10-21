// Features only the cloud dashboard has are Convex functions keyed by Convex
// document ids: macros, which the dashboard keeps; the installed-module list,
// which Convex records; and browser-source keys, minted per scene row. Engine
// calls about those records take the gateway's own ids. Under the Convex
// gateway the two name the same documents, so these features convert between
// them here, and only here: nothing else outside client/src/engine may reach
// the Convex adapter's ids.

export { fromSceneId, toMacroId, toModuleId } from "@/engine/convex/ids";
