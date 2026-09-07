import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction } from "convex/react";
import { useCallback, useState } from "react";
import type { Resource } from "@/hooks/use-resources";

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

          const response = await fetch(grant.uploadUrl, { method: grant.method, headers, body: file });
          if (!response.ok) {
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
    [instanceId, requestUpload, completeUpload, requestProcessing]
  );

  return { upload, isUploading, progress };
}
