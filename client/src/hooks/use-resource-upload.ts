import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction } from "convex/react";
import { useCallback, useState } from "react";
import type { Resource } from "@/hooks/use-resources";

/**
 * A PUT that never reached storage throws a bare TypeError: a refused CORS
 * preflight is indistinguishable from an unreachable host to the page that
 * made the request, by design. Storage on a bucket the operator has not given
 * a CORS policy fails exactly this way, so the message names that first.
 */
const UNREACHABLE_STORAGE =
  "the browser could not reach storage. If assets are stored on S3 or R2, that bucket needs a CORS policy allowing PUT from this site — or set the engine's storage.uploadMode to relay.";

/**
 * Uploads files to engine-backed storage.
 *
 * Three steps per file: ask the engine for a grant, PUT the bytes straight at
 * storage, then report completion. The grant is provider-agnostic — an S3
 * presigned URL or the engine's own token-guarded endpoint — so this replays
 * exactly the headers it was handed and never branches on which backend is
 * configured. Bytes never pass through Convex.
 *
 * Shared by the Assets page and the asset picker so the sequence exists once.
 */
export function useResourceUpload(instanceId: Id<"instances"> | undefined) {
  const requestUpload = useAction(api.resources.requestUpload);
  const completeUpload = useAction(api.resources.completeUpload);
  const requestProcessing = useAction(api.resources.requestProcessing);
  const removeResource = useAction(api.resources.remove);

  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState("");

  /**
   * Resolves with the resources that landed. Throws on the first failure, so a
   * partial batch still reports what succeeded via `uploaded` on the error.
   */
  const upload = useCallback(
    async (files: FileList | File[], parentId: string | null): Promise<Resource[]> => {
      const list = Array.from(files);
      if (list.length === 0 || !instanceId) {
        return [];
      }

      setIsUploading(true);
      const done: Resource[] = [];
      // Best effort: the upload already failed, and a reservation that outlives
      // it is untidy rather than harmful, so this must not mask that failure.
      const discardReservation = async (resourceId: string) => {
        try {
          await removeResource({ instanceId, resourceId });
        } catch {}
      };
      try {
        for (let i = 0; i < list.length; i++) {
          const file = list[i];
          setProgress(`Uploading ${file.name} (${i + 1}/${list.length})…`);

          const grant = await requestUpload({
            instanceId,
            name: file.name,
            contentType: file.type || "application/octet-stream",
            parentId,
            size: file.size,
          });

          const headers = new Headers();
          for (const header of grant.headers) {
            headers.set(header.name, header.value);
          }

          // The grant reserved a row before the bytes were sent, so a PUT that
          // never landed leaves a resource holding nothing. It is dropped here
          // rather than left in the list as an asset that cannot be opened.
          let response: Response;
          try {
            response = await fetch(grant.uploadUrl, { method: grant.method, headers, body: file });
          } catch (err) {
            await discardReservation(grant.resource.id);
            throw Object.assign(new Error(`${file.name}: ${UNREACHABLE_STORAGE}`, { cause: err }), { uploaded: done });
          }
          if (!response.ok) {
            await discardReservation(grant.resource.id);
            throw Object.assign(new Error(`${file.name}: upload failed (${response.status})`), { uploaded: done });
          }

          const resource = await completeUpload({ instanceId, resourceId: grant.resource.id, size: file.size });
          done.push(resource);

          // Fire-and-forget: thumbnailing is asynchronous, and a resource the
          // utility cannot render (audio) keeps a null thumbnail rather than
          // failing — so a rejection here must never fail the upload.
          if (resource.kind === "image" || resource.kind === "video") {
            void requestProcessing({ instanceId, resourceId: resource.id, utility: "thumbnail" }).catch(() => {});
          }
        }
        return done;
      } finally {
        setIsUploading(false);
        setProgress("");
      }
    },
    [instanceId, requestUpload, completeUpload, requestProcessing, removeResource]
  );

  return { upload, isUploading, progress };
}
