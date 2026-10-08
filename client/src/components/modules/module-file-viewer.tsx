import Editor, { type OnMount } from "@monaco-editor/react";
import { useCallback, useState } from "react";
import { useTheme } from "@/hooks/use-theme";
import { getLanguageFromPath } from "@/lib/module-files";

/** Tall enough for a short function to show whole; longer files scroll inside the viewer. */
const MAX_HEIGHT_PX = 480;
const MIN_HEIGHT_PX = 60;
const INITIAL_HEIGHT_PX = 160;

interface ModuleFileViewerProps {
  path: string;
  content: string;
}

/**
 * A module file in a read-only Monaco editor that grows with its content up
 * to `MAX_HEIGHT_PX`. The default export is what `React.lazy` loads, keeping
 * Monaco out of the module page until a file is opened.
 */
export default function ModuleFileViewer({ path, content }: ModuleFileViewerProps) {
  const { mode } = useTheme();
  const [height, setHeight] = useState(INITIAL_HEIGHT_PX);

  // Wrapped lines make the content taller than its line count, so the height
  // follows the editor's own measurement rather than a line-count estimate.
  const handleMount = useCallback<OnMount>((editor) => {
    const fit = () => {
      setHeight(Math.min(MAX_HEIGHT_PX, Math.max(MIN_HEIGHT_PX, editor.getContentHeight())));
    };
    editor.onDidContentSizeChange(fit);
    fit();
  }, []);

  return (
    <div className="overflow-hidden rounded-md border" data-testid="module-file-viewer">
      <Editor
        height={height}
        language={getLanguageFromPath(path)}
        value={content}
        theme={mode === "dark" ? "vs-dark" : "vs"}
        onMount={handleMount}
        options={{
          readOnly: true,
          domReadOnly: true,
          contextmenu: false,
          lineNumbers: "on",
          wordWrap: "on",
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          fontSize: 13,
          renderLineHighlight: "none",
          scrollbar: { alwaysConsumeMouseWheel: false },
        }}
      />
    </div>
  );
}
