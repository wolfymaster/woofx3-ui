import { useStore } from "@nanostores/react";
import { $thumbnailTick, liveThumbnailUrl } from "@/lib/thumbnail-tick";

interface LiveThumbnailProps {
  login: string;
  alt: string;
  className?: string;
}

/**
 * Twitch's public live-preview image for a channel. Render it only while the
 * channel is live: mounting it is what keeps the shared refresh ticking.
 */
export function LiveThumbnail({ login, alt, className }: LiveThumbnailProps) {
  const tick = useStore($thumbnailTick);
  return <img src={liveThumbnailUrl(login, tick)} alt={alt} className={className} />;
}
