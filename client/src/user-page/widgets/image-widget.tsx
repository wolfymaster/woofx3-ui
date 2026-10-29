import { imageUrl, linkUrl } from "../urls";
import type { WidgetOf } from "./types";

export function ImageWidget({ widget }: { widget: WidgetOf<"image"> }) {
  const src = imageUrl(widget.config.image.url);
  if (src === null) {
    return null;
  }
  const image = (
    <img
      src={src}
      alt={widget.config.alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className="h-auto w-full rounded-xl"
    />
  );
  const href = widget.config.linkUrl === undefined ? null : linkUrl(widget.config.linkUrl);
  if (href === null) {
    return image;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow ugc"
      className="block rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      {image}
    </a>
  );
}
