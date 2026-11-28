import { useMemo } from "react";
import { rawUrl } from "../../lib/api.ts";

/** Native browser PDF viewer; changedTick busts the cache so each SSE "changed"
 *  event shows the fresh render. */
export function PdfFrame({ docId, changedTick }: { docId: number; changedTick: number }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const src = useMemo(() => rawUrl(docId), [docId, changedTick]);
  return (
    <div className="flex justify-center" data-component="PdfFrame">
      <iframe
        title="pdf"
        src={src}
        className="h-[calc(100vh-8rem)] w-full rounded-[10px] border border-border shadow-lg"
      />
    </div>
  );
}
