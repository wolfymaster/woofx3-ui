import type { PageTheme } from "@shared/user-pages";
import { imageUrl } from "./urls";

/**
 * The banner, and over its lower edge the avatar and the page's name set as a
 * broadcast lower third: an accent tab beside a solid plate.
 */
export function PageHeader({ name, theme }: { name: string; theme: PageTheme }) {
  const banner = theme.banner ? imageUrl(theme.banner.url) : null;
  const avatar = theme.avatar ? imageUrl(theme.avatar.url) : null;
  return (
    <header>
      <div className="aspect-[2/1] overflow-hidden sm:aspect-[3/1] sm:rounded-b-3xl">
        {banner === null ? (
          <div className="banner-fallback h-full w-full" />
        ) : (
          <img src={banner} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
        )}
      </div>
      <div className="-mt-10 flex flex-col items-start gap-4 px-4 sm:-mt-14 sm:flex-row sm:items-end sm:px-6">
        {avatar !== null && (
          <img
            src={avatar}
            alt=""
            referrerPolicy="no-referrer"
            className="h-24 w-24 shrink-0 rounded-2xl border-4 border-paper bg-surface object-cover sm:h-32 sm:w-32"
          />
        )}
        <div className={`flex max-w-full items-stretch shadow-lg ${avatar === null ? "" : "sm:mb-2"}`}>
          <span className="w-2.5 shrink-0 bg-accent sm:w-3" aria-hidden="true" />
          <h1 className="min-w-0 break-words bg-ink px-4 py-2 text-4xl font-extrabold tracking-tight text-paper sm:px-5 sm:text-6xl">
            {name}
          </h1>
        </div>
      </div>
    </header>
  );
}
