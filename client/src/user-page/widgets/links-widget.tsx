import { displayHost, linkUrl } from "../urls";
import type { WidgetOf } from "./types";

export function LinksWidget({ widget }: { widget: WidgetOf<"links"> }) {
  const links = widget.config.links.flatMap((link) => {
    const href = linkUrl(link.url);
    return href === null ? [] : [{ label: link.label, href }];
  });
  if (links.length === 0) {
    return null;
  }
  return (
    <ul className="-mx-2 flex flex-col">
      {links.map((link) => (
        <li key={link.href}>
          <a
            href={link.href}
            target="_blank"
            rel="noopener noreferrer nofollow ugc"
            className="group flex items-baseline justify-between gap-4 rounded-lg px-2 py-2.5 hover:bg-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <span className="font-semibold underline-offset-4 group-hover:underline">{link.label}</span>
            <span className="truncate text-sm text-muted">{displayHost(link.href)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
