import type { CatalogListingDetail } from "@shared/marketplace-catalog";
import { Eye, Image as ImageIcon, MonitorPlay, Play } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { galleryPreviews, livePreviewTarget, previewAvailable } from "@/lib/listing-preview-target";
import { cn } from "@/lib/utils";

// The preview dialog. Which previews a listing has, and whether it has any at
// all, is decided by lib/listing-preview-target.ts -- that answer differs per
// type and is worth testing without rendering anything.

interface PreviewButtonProps {
  listing: CatalogListingDetail;
  className?: string;
}

/** Opens the preview gallery. Renders nothing when there is nothing to show. */
export function PreviewButton({ listing, className }: PreviewButtonProps) {
  const [open, setOpen] = useState(false);
  if (!previewAvailable(listing)) {
    return null;
  }
  return (
    <>
      <Button variant="outline" className={cn("gap-2", className)} onClick={() => setOpen(true)}>
        <Eye className="h-4 w-4" />
        Preview
      </Button>
      <PreviewDialog listing={listing} open={open} onOpenChange={setOpen} />
    </>
  );
}

function PreviewDialog({
  listing,
  open,
  onOpenChange,
}: {
  listing: CatalogListingDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const gallery = galleryPreviews(listing);
  const live = livePreviewTarget(listing);
  const [selected, setSelected] = useState(0);
  const shown = gallery[Math.min(selected, Math.max(gallery.length - 1, 0))];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{listing.name}</DialogTitle>
          <DialogDescription>
            {gallery.length > 0 ? "What it looks like before you install it." : "This listing has no screenshots yet."}
          </DialogDescription>
        </DialogHeader>

        {shown && (
          <figure className="space-y-2">
            <div className="overflow-hidden rounded-lg border bg-muted">
              {shown.kind === "video" ? (
                // Controls only, and no autoplay: a preview that starts
                // playing sound over a live stream is a bad surprise.
                // biome-ignore lint/a11y/useMediaCaption: a preview video is a file the listing's author uploaded and the marketplace models no caption track for one, so there is none to point at; the caption it does carry is the visible figcaption below.
                <video src={shown.url} controls className="h-auto max-h-[55vh] w-full" />
              ) : (
                <img src={shown.url} alt={shown.caption ?? ""} className="h-auto max-h-[55vh] w-full object-contain" />
              )}
            </div>
            {shown.caption && <figcaption className="text-xs text-muted-foreground">{shown.caption}</figcaption>}
          </figure>
        )}

        {gallery.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {gallery.map((preview, index) => (
              <button
                key={preview.url}
                type="button"
                aria-label={`Show preview ${index + 1}`}
                onClick={() => setSelected(index)}
                className={cn(
                  "flex h-12 w-20 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted",
                  index === selected && "ring-2 ring-primary"
                )}
              >
                {preview.kind === "video" ? (
                  <Play className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <img src={preview.url} alt="" className="h-full w-full object-cover" />
                )}
              </button>
            ))}
          </div>
        )}

        {live && (
          <div className="flex items-start gap-3 rounded-lg border border-primary/25 bg-primary/5 p-3">
            <MonitorPlay className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div className="space-y-1 text-sm">
              <p className="font-medium">Live preview</p>
              <p className="text-xs text-muted-foreground">
                {live.caption ?? "Install it, then place it in a scene to see it render live."}
              </p>
            </div>
          </div>
        )}

        {gallery.length === 0 && !live && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <ImageIcon className="h-4 w-4" />
            Nothing to preview yet.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
