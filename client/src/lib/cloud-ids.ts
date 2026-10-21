// Features only the cloud dashboard has (the setup wizard, browser-source
// keys) are Convex functions keyed by Convex document ids, while the engine
// gateway speaks its own ids. Under the Convex gateway the two are the same
// documents, so these features convert between them here, and only here: a
// gateway without Convex has none of these features, and nothing else
// outside client/src/engine may reach the Convex adapter's ids.

export { fromSceneId } from "@/engine/convex/ids";
