import type { ModuleFileEntry } from "@woofx3/api/api";

/** Monaco language ids by lower-case file extension. Anything else is plain text. */
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescript",
  json: "json",
  lua: "lua",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  less: "less",
  md: "markdown",
  markdown: "markdown",
  svg: "xml",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  txt: "plaintext",
  py: "python",
  go: "go",
  rs: "rust",
  sh: "shell",
  bash: "shell",
};

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/** The Monaco language for a file path, `plaintext` when the extension is unknown. */
export function getLanguageFromPath(path: string): string {
  return LANGUAGE_BY_EXTENSION[extensionOf(path)] ?? "plaintext";
}

export type ModuleFileCategory = "code" | "data" | "markup" | "image" | "text" | "other";

const CATEGORY_BY_EXTENSION: Record<string, ModuleFileCategory> = {
  js: "code",
  mjs: "code",
  cjs: "code",
  jsx: "code",
  ts: "code",
  mts: "code",
  cts: "code",
  tsx: "code",
  lua: "code",
  py: "code",
  go: "code",
  rs: "code",
  sh: "code",
  json: "data",
  yaml: "data",
  yml: "data",
  html: "markup",
  htm: "markup",
  css: "markup",
  scss: "markup",
  less: "markup",
  xml: "markup",
  svg: "image",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  ico: "image",
  md: "text",
  markdown: "text",
  txt: "text",
};

/** A coarse kind of file, for picking its icon in the file tree. */
export function getFileCategory(path: string): ModuleFileCategory {
  return CATEGORY_BY_EXTENSION[extensionOf(path)] ?? "other";
}

export type ModuleFileTreeNode =
  | { kind: "folder"; name: string; path: string; children: ModuleFileTreeNode[] }
  | { kind: "file"; name: string; path: string; size: number };

type FolderNode = Extract<ModuleFileTreeNode, { kind: "folder" }>;

function sortTree(nodes: ModuleFileTreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === "folder" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
  for (const node of nodes) {
    if (node.kind === "folder") {
      sortTree(node.children);
    }
  }
}

/** A folder tree from a flat file list: folders before files, each level sorted by name. */
export function buildModuleFileTree(files: readonly ModuleFileEntry[]): ModuleFileTreeNode[] {
  const root: ModuleFileTreeNode[] = [];
  const folders = new Map<string, FolderNode>();
  for (const file of files) {
    const parts = file.path.split("/").filter((part) => part !== "");
    if (parts.length === 0) {
      continue;
    }
    let siblings = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const folderPath = parts.slice(0, i + 1).join("/");
      let folder = folders.get(folderPath);
      if (!folder) {
        folder = { kind: "folder", name: parts[i], path: folderPath, children: [] };
        folders.set(folderPath, folder);
        siblings.push(folder);
      }
      siblings = folder.children;
    }
    siblings.push({ kind: "file", name: parts[parts.length - 1], path: parts.join("/"), size: file.size });
  }
  sortTree(root);
  return root;
}

/**
 * The listed path a function's `file` refers to: the exact path, else the one
 * file with the same name. A function registered without the manifest only
 * knows its file name (`battle.js`), which is why the name alone may match;
 * null when nothing matches or the name is ambiguous.
 */
export function matchFunctionFile(file: string | undefined, files: readonly ModuleFileEntry[]): string | null {
  if (!file) {
    return null;
  }
  const wanted = file.replace(/\\/g, "/").replace(/^(\.\/)+/, "");
  if (files.some((entry) => entry.path === wanted)) {
    return wanted;
  }
  const name = wanted.slice(wanted.lastIndexOf("/") + 1);
  const sameName = files.filter((entry) => entry.path.slice(entry.path.lastIndexOf("/") + 1) === name);
  return sameName.length === 1 ? sameName[0].path : null;
}

/** A byte count for people: `512 B`, `28 KB`, `1.4 MB`. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kilobytes = Math.round(bytes / 1024);
  if (kilobytes < 1024) {
    return `${kilobytes} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
