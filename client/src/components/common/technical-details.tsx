export function TechnicalDetails({ text }: { text: string }) {
  return (
    <details className="max-w-lg text-left">
      <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
        Technical details
      </summary>
      <p className="mt-2 break-words rounded-md bg-muted/60 p-2 font-mono text-[11px] text-muted-foreground">{text}</p>
    </details>
  );
}
