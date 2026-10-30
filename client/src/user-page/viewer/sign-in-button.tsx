/**
 * The page's sign-in action, set like the header's name plate: an accent tab
 * beside an ink plate, so it reads as part of the page rather than a
 * platform's badge.
 */
export function SignInButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group inline-flex items-stretch shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <span className="w-1.5 shrink-0 bg-accent group-hover:w-2.5 motion-safe:transition-[width]" aria-hidden="true" />
      <span className="bg-ink px-3.5 py-2 text-sm font-bold text-paper">{label}</span>
    </button>
  );
}
