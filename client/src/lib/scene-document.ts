/**
 * The scene as a document, and the json0 ops that change it: the wire format
 * the dashboard's scene editor shares with sceneManager and the sync client
 * (`@woofx3/api/scene-editor`). Converting between a document and the
 * editor's canvas is the dashboard's own, in `scene-document-widgets.ts`.
 */
export * from "@woofx3/api/scene-editor/document";
