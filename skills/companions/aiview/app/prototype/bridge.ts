// Prototype variants. A prototype declares its variants (states, steps, alternatives of one
// screen) and its actions as static buttons inside a `data-component="PrototypeBar"`
// element: `data-aiview-variant="name"` for an exclusive variant, aria-pressed on the
// current one, `data-aiview-action="name"` for a plain action. The viewer mirrors them
// in its own toolbar above the frame, hides the in-page bar, and drives the page through
// a message the bridge below turns into a click on the declared button. So a variant can
// be switched in Composition, where the page itself takes no mouse, and the chosen
// variant survives a live reload.
export const BRIDGE_MARK = "data-aiview-bridge";

export interface PrototypeControl {
  name: string;
  label: string;
}

export interface PrototypeControls {
  variants: PrototypeControl[];
  /** The variant marked aria-pressed in the file, or the first one. */
  initial: string | null;
  actions: PrototypeControl[];
}

const EMPTY: PrototypeControls = { variants: [], initial: null, actions: [] };

/** Read the declared controls from the served html. Static markup only: what a script adds later is invisible here, by design. */
export function prototypeControls(html: string): PrototypeControls {
  if (!html.includes("data-aiview-")) return EMPTY;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const read = (attr: string): PrototypeControl[] =>
    [...doc.querySelectorAll(`[${attr}]`)]
      .map((el) => ({ name: el.getAttribute(attr) ?? "", label: (el.textContent ?? "").trim() || el.getAttribute(attr) || "" }))
      .filter((c) => c.name);
  const variants = read("data-aiview-variant");
  const pressed = doc.querySelector('[data-aiview-variant][aria-pressed="true"]')?.getAttribute("data-aiview-variant");
  return { variants, initial: pressed ?? variants[0]?.name ?? null, actions: read("data-aiview-action") };
}

// legacyMockupBar: files written before the rename still name the bar MockupBar
const legacyMockupBar = `[data-component="MockupBar"]`;
const CSS = `[data-component="PrototypeBar"],${legacyMockupBar}{display:none !important}`;

const SCRIPT = `
(function(){
  window.addEventListener('message',function(e){
    var d=e.data||{}; var sel=null;
    if(d.type==='aiview:variant'&&typeof d.name==='string') sel='[data-aiview-variant="'+d.name.replace(/"/g,'')+'"]';
    if(d.type==='aiview:action'&&typeof d.name==='string') sel='[data-aiview-action="'+d.name.replace(/"/g,'')+'"]';
    if(!sel) return; var b=document.querySelector(sel); if(b) b.click();
  });
})();
`;

/** The served html with the bridge appended: the in-page bar hidden, the message listener installed. */
export function withBridge(html: string): string {
  if (!html.includes("data-aiview-")) return html;
  const snippet = `<style ${BRIDGE_MARK}>${CSS}</style><script ${BRIDGE_MARK}>${SCRIPT}</script>`;
  const i = html.lastIndexOf("</body>");
  return i < 0 ? html + snippet : html.slice(0, i) + snippet + html.slice(i);
}
