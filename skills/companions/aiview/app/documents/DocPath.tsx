import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { truncatePath } from "../lib/utils.ts";

/** In the top bar, right-justified: the document's absolute local path, click copies it. */
export function DocPath({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — the tooltip still shows the full path */
    }
  };
  return (
    <button
      data-component="DocPath"
      onClick={copy}
      title={copied ? "Path copied" : `Copy path\n${path}`}
      className="inline-flex min-w-0 max-w-[38ch] shrink cursor-pointer items-center gap-1.5 overflow-hidden whitespace-nowrap h-7 rounded-md px-2 font-mono text-[11px] text-muted-foreground hover:bg-surface-2 hover:text-foreground"
    >
      {copied ? <Check size={12} className="shrink-0 text-ok" /> : <Copy size={12} className="shrink-0 opacity-60" />}
      {copied ? "Path copied" : truncatePath(path)}
    </button>
  );
}
