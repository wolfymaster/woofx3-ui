/** What the right rail shows with nothing selected, so the rail is never blank. */
export function CanvasSummary({ width, height, count }: { width: number; height: number; count: number }) {
  return (
    <div className="flex flex-col gap-4 p-4">
      <h2 className="text-sm font-semibold">Canvas</h2>
      <p className="text-xs text-muted-foreground">
        Select a widget on the canvas or in the layers above to edit it, or add one from the left.
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Size</dt>
        <dd className="font-mono text-xs leading-5">
          {width} × {height}
        </dd>
        <dt className="text-muted-foreground">Widgets</dt>
        <dd className="font-mono text-xs leading-5">{count}</dd>
      </dl>
    </div>
  );
}
