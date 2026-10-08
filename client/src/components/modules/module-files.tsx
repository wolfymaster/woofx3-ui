import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  File,
  FileCode,
  FileImage,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { lazy, type ReactNode, Suspense, useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ModuleFiles } from "@/hooks/use-module-files";
import {
  buildModuleFileTree,
  formatFileSize,
  getFileCategory,
  type ModuleFileCategory,
  type ModuleFileTreeNode,
} from "@/lib/module-files";
import { cn } from "@/lib/utils";

const ModuleFileViewer = lazy(() => import("@/components/modules/module-file-viewer"));

const TREE_INDENT_PX = 16;

const CATEGORY_ICONS: Record<ModuleFileCategory, typeof File> = {
  code: FileCode,
  data: FileJson,
  markup: FileCode,
  image: FileImage,
  text: FileText,
  other: File,
};

function InlineMessage({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "error" }) {
  return (
    <p className={cn("text-xs px-3 py-2", tone === "error" ? "text-destructive" : "text-muted-foreground")}>
      {children}
    </p>
  );
}

/**
 * Why the files cannot be browsed yet, or null when they can. An installed
 * module's files need an engine with the file methods.
 */
export function ModuleFilesSupportNotice({ files }: { files: ModuleFiles }) {
  if (files.support === "supported") {
    return null;
  }
  if (files.support === "checking") {
    return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  }
  if (files.support === "unsupported") {
    return (
      <Alert data-testid="module-files-needs-update">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Update WoofX3 to browse this module's files</AlertTitle>
        <AlertDescription>
          The engine this instance runs can't share a module's files yet. Update it to the latest release; this view
          checks again when the engine reconnects.
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert data-testid="module-files-unknown">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Couldn't check your engine</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>Browsing an installed module's files depends on what your engine supports, and it didn't answer.</p>
        <Button variant="outline" size="sm" onClick={files.retrySupport}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Try again
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/**
 * One file's contents, fetched when shown. Text opens in a read-only editor;
 * binary and oversized files get a note instead.
 */
export function ModuleFileContentView({ files, path }: { files: ModuleFiles; path: string }) {
  const { loadFile } = files;
  useEffect(() => {
    loadFile(path);
  }, [loadFile, path]);

  const state = files.file(path);
  if (!state || state.status === "loading") {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading {path}...
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <span className="text-xs text-destructive break-words min-w-0">
          Couldn't open {path}: {state.message}
        </span>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => loadFile(path)}>
          Try again
        </Button>
      </div>
    );
  }
  const { file } = state;
  if (file.kind === "binary") {
    return <InlineMessage>Binary file · {formatFileSize(file.size)}</InlineMessage>;
  }
  if (file.kind === "too_large") {
    return <InlineMessage>Too large to preview ({formatFileSize(file.size)})</InlineMessage>;
  }
  return (
    <Suspense
      fallback={
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Opening viewer...
        </div>
      }
    >
      <ModuleFileViewer path={file.path} content={file.content} />
    </Suspense>
  );
}

interface FileTreeProps {
  nodes: ModuleFileTreeNode[];
  depth: number;
  collapsedFolders: ReadonlySet<string>;
  onToggleFolder: (path: string) => void;
  openFiles: ReadonlySet<string>;
  onToggleFile: (path: string) => void;
  files: ModuleFiles;
}

function FileTree({ nodes, depth, collapsedFolders, onToggleFolder, openFiles, onToggleFile, files }: FileTreeProps) {
  return (
    <ul className="space-y-0.5">
      {nodes.map((node) => {
        const indent = { paddingLeft: `${depth * TREE_INDENT_PX + 8}px` };
        if (node.kind === "folder") {
          const expanded = !collapsedFolders.has(node.path);
          const FolderIcon = expanded ? FolderOpen : Folder;
          const Chevron = expanded ? ChevronDown : ChevronRight;
          return (
            <li key={node.path}>
              <button
                type="button"
                className="flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-sm hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={indent}
                aria-expanded={expanded}
                onClick={() => onToggleFolder(node.path)}
              >
                <Chevron className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <FolderIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{node.name}</span>
              </button>
              {expanded && (
                <FileTree
                  nodes={node.children}
                  depth={depth + 1}
                  collapsedFolders={collapsedFolders}
                  onToggleFolder={onToggleFolder}
                  openFiles={openFiles}
                  onToggleFile={onToggleFile}
                  files={files}
                />
              )}
            </li>
          );
        }
        const open = openFiles.has(node.path);
        const Icon = CATEGORY_ICONS[getFileCategory(node.path)];
        return (
          <li key={node.path}>
            <Collapsible open={open} onOpenChange={() => onToggleFile(node.path)}>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-sm hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    open && "bg-accent"
                  )}
                  style={indent}
                  title={node.path}
                  data-testid={`module-file-${node.path}`}
                >
                  <span className="w-3.5 shrink-0" />
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{node.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {formatFileSize(node.size)}
                  </span>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="py-1 pl-2">
                <ModuleFileContentView files={files} path={node.path} />
              </CollapsibleContent>
            </Collapsible>
          </li>
        );
      })}
    </ul>
  );
}

function toggled(set: ReadonlySet<string>, value: string): Set<string> {
  const next = new Set(set);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
}

/** Every file the module ships, as a folder tree whose files open inline. */
export function ModuleFilesTab({ files }: { files: ModuleFiles }) {
  const { loadList, list, support } = files;
  const [collapsedFolders, setCollapsedFolders] = useState<ReadonlySet<string>>(() => new Set());
  const [openFiles, setOpenFiles] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    loadList();
  }, [loadList]);

  const tree = useMemo(() => (list.status === "ready" ? buildModuleFileTree(list.list.files) : []), [list]);

  let body: ReactNode;
  if (support !== "supported") {
    body = <ModuleFilesSupportNotice files={files} />;
  } else if (list.status === "idle" || list.status === "loading") {
    body = (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading files...
      </div>
    );
  } else if (list.status === "error") {
    body = (
      <div className="space-y-2">
        <p className="text-sm text-destructive break-words">Couldn't list this module's files: {list.message}</p>
        <Button variant="outline" size="sm" onClick={loadList}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Try again
        </Button>
      </div>
    );
  } else if (!list.list.available) {
    body = (
      <p className="text-sm text-muted-foreground">
        This module's files aren't available. It was installed in a way that didn't keep a copy of them.
      </p>
    );
  } else if (tree.length === 0) {
    body = <p className="text-sm text-muted-foreground">This module has no files.</p>;
  } else {
    body = (
      <FileTree
        nodes={tree}
        depth={0}
        collapsedFolders={collapsedFolders}
        onToggleFolder={(path) => setCollapsedFolders((prev) => toggled(prev, path))}
        openFiles={openFiles}
        onToggleFile={(path) => setOpenFiles((prev) => toggled(prev, path))}
        files={files}
      />
    );
  }

  return (
    <ScrollArea className="flex-1 min-h-0 pr-4" data-testid="module-files-tab">
      <div className="pb-4">{body}</div>
    </ScrollArea>
  );
}
