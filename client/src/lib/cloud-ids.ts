// Features only the cloud dashboard has are Convex functions keyed by Convex
// document ids: a macro's remote trigger, which Convex serves for a macro the
// Convex gateway keeps. Under the Convex gateway the gateway's ids and the Convex
// ids name the same documents, so these features convert between them here, and
// only here: nothing else outside client/src/engine may reach the Convex adapter's ids.

export { fromMacroId } from "@/engine/convex/ids";
