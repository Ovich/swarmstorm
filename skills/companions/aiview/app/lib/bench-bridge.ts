// The bench bridge: how a workbench, framed with an opaque origin, reads its sidecar
// folder and keeps the person's place. The frame keeps srcDoc and a sandbox without
// allow-same-origin (D2), so it cannot fetch the server itself: the injected script
// patches `fetch` so a relative URL is relayed to the app as `aiview:data`, and the app
// (useBenchRelay) checks the sender and the path, fetches the sidecar file and answers
// with the server's status and body. Any other URL goes to the native fetch (D12).
//
// The place (a tab, a view, a run) is `window.aiview.state`: injected once per srcDoc
// build, and every set is posted up as `aiview:state` and stored in the app's
// localStorage under `aiview.bench.<id>.<key>`, never rebuilding the srcDoc (D18), which
// would reload the frame. When the feed commits, the app posts `aiview:data-changed`;
// the script hands it to the loader's `window.aiview.onFed` and to a window event.
// Prototypes are never bridged (D6).
import { type RefObject, useEffect } from "react";

export const BENCH_BRIDGE_MARK = "data-aiview-bench";

/** Bodies above this, by content-length, are refused 413 rather than relayed. */
const MAX_RELAY_BYTES = 64 * 1024 * 1024;

const STATE_PREFIX = "aiview.bench.";

const SEGMENT = "[A-Za-z0-9_-][A-Za-z0-9._-]*";
const SIDECAR_GRAMMAR = new RegExp(`^${SEGMENT}(/${SEGMENT})*$`);
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** D2's grammar, after decoding: plain segments, none ending in a dot, none a Windows device name. */
export function isSidecarPath(p: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(p);
  } catch {
    return false;
  }
  if (!SIDECAR_GRAMMAR.test(decoded)) return false;
  return decoded.split("/").every((seg) => !seg.endsWith(".") && !WINDOWS_DEVICE.test(seg.split(".")[0]));
}

/** The person's place in workbench `id`, read from the app's localStorage. */
export function benchState(id: number): Record<string, string> {
  const prefix = `${STATE_PREFIX}${id}.`;
  const place: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(prefix)) place[k.slice(prefix.length)] = localStorage.getItem(k) ?? "";
    }
  } catch {}
  return place;
}

const frameScript = (state: Record<string, string>) => `
(function(){
  var nativeFetch = window.fetch.bind(window), pending = {}, seq = 0;
  var place = ${JSON.stringify(state).replace(/</g, "\\u003c")};
  var state = new Proxy(place, {
    set: function(t, k, v){ t[k] = String(v); parent.postMessage({type:'aiview:state', key:String(k), value:String(v)}, '*'); return true; },
    deleteProperty: function(t, k){ delete t[k]; parent.postMessage({type:'aiview:state', key:String(k), value:null}, '*'); return true; }
  });
  window.aiview = { bridge: 1, state: state };
  function relative(u){ return typeof u === 'string' && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(u) && u.charAt(0) !== '/'; }
  window.fetch = function(input, init){
    var url = typeof input === 'string' ? input : (input && input.url);
    if (typeof input !== 'string' || !relative(url)) return nativeFetch(input, init);
    var req = ++seq;
    return new Promise(function(resolve){
      pending[req] = resolve;
      parent.postMessage({type:'aiview:data', req: req, path: url.split(/[?#]/)[0]}, '*');
    });
  };
  window.addEventListener('message', function(e){
    if (e.source !== parent) return;
    var d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'aiview:data' && pending[d.req]) {
      var resolve = pending[d.req]; delete pending[d.req];
      var headers = d.contentType ? {'content-type': d.contentType} : {};
      if (!d.ok && d.bytes != null) headers['x-aiview-bytes'] = String(d.bytes);
      resolve(new Response(d.status === 204 || d.status === 304 ? null : (d.body || null), {status: d.status, headers: headers}));
    } else if (d.type === 'aiview:data-changed') {
      if (typeof window.aiview.onFed === 'function') { try { window.aiview.onFed(); } catch (err) { console.error(err); } }
      window.dispatchEvent(new Event('aiview:data-changed'));
    }
  });
})();
`;

/** The html with the bench bridge injected, carrying the place it starts from. */
export function withBenchBridge(html: string, init: { state: Record<string, string> }): string {
  if (html.includes(BENCH_BRIDGE_MARK)) return html;
  const snippet = `<script ${BENCH_BRIDGE_MARK}>${frameScript(init.state)}</script>`;
  // Before the page's own scripts, so a fetch at load is already relayed.
  const head = html.match(/<head[^>]*>/i);
  if (head) {
    const i = head.index! + head[0].length;
    return html.slice(0, i) + snippet + html.slice(i);
  }
  return snippet + html;
}

/** The sidecar folder's url prefix for a doc, or null when the doc is not an html file. */
function sidecarBase(doc: { id: number; file_path: string }): string | null {
  if (!/\.html$/i.test(doc.file_path)) return null;
  const stem = doc.file_path.replace(/\.html$/i, "").split("/").pop()!;
  return `/api/asset/${doc.id}/${encodeURIComponent(stem)}/`;
}

type RelayAnswer = { req: number; ok: boolean; status: number; body?: ArrayBuffer; contentType?: string; bytes?: number };

async function relaySidecarRead(base: string | null, path: string, req: number): Promise<RelayAnswer> {
  if (!base || !isSidecarPath(path)) return { req, ok: false, status: 400 };
  const url = base + decodeURIComponent(path).split("/").map(encodeURIComponent).join("/");
  try {
    const res = await fetch(url);
    const bytes = Number(res.headers.get("content-length"));
    if (bytes > MAX_RELAY_BYTES) {
      void res.body?.cancel();
      return { req, ok: false, status: 413, bytes };
    }
    const body = await res.arrayBuffer();
    return { req, ok: res.ok, status: res.status, body, contentType: res.headers.get("content-type") ?? undefined };
  } catch {
    return { req, ok: false, status: 502 };
  }
}

/** The app's side of the bridge: answers the frame's reads, stores its place, tells it of new data. */
export function useBenchRelay(frame: RefObject<HTMLIFrameElement | null>, doc: { id: number; file_path: string }, dataTick: number): void {
  const { id, file_path } = doc;
  useEffect(() => {
    const base = sidecarBase({ id, file_path });
    const onMessage = (e: MessageEvent) => {
      const win = frame.current?.contentWindow;
      if (!win || e.source !== win) return;
      const d = e.data as { type?: unknown; req?: unknown; path?: unknown; key?: unknown; value?: unknown } | null;
      if (d?.type === "aiview:data" && typeof d.req === "number" && typeof d.path === "string") {
        void relaySidecarRead(base, d.path, d.req).then((answer) => {
          const msg = { type: "aiview:data", ...answer };
          win.postMessage(msg, "*", answer.body ? [answer.body] : []);
        });
      } else if (d?.type === "aiview:state" && typeof d.key === "string") {
        try {
          if (typeof d.value === "string") localStorage.setItem(`${STATE_PREFIX}${id}.${d.key}`, d.value);
          else localStorage.removeItem(`${STATE_PREFIX}${id}.${d.key}`);
        } catch {}
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frame, id, file_path]);

  useEffect(() => {
    if (!dataTick) return;
    frame.current?.contentWindow?.postMessage({ type: "aiview:data-changed" }, "*");
  }, [frame, dataTick]);
}
