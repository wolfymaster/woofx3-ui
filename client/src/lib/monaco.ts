import Editor, { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

// The editor's default loader injects a script from a CDN, which the desktop
// app's `script-src 'self'` refuses. Handing it the bundled module (and
// bundled workers) keeps every byte on our origin.
const WORKER_BY_LABEL: Record<string, new () => Worker> = {
  css: cssWorker,
  scss: cssWorker,
  less: cssWorker,
  html: htmlWorker,
  handlebars: htmlWorker,
  razor: htmlWorker,
  json: jsonWorker,
  typescript: tsWorker,
  javascript: tsWorker,
};

self.MonacoEnvironment = {
  getWorker: (_workerId, label) => new (WORKER_BY_LABEL[label] ?? editorWorker)(),
};

loader.config({ monaco });

export { Editor };
export type { OnMount } from "@monaco-editor/react";
