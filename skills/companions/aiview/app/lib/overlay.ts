// Composition mode: what the frame injects into a served prototype so the person can see
// which regions were bound from elsewhere. Everything drawn lives in one fixed layer
// appended to <body>, positioned from measured rectangles: nothing is inserted into the
// host's flow, so the host's layout is exactly what Rendered mode shows.
//
// The layer takes every pointer event. In Composition the prototype is looked at, not
// operated: its hover states and clicks stay quiet. Wheel scrolling still reaches the
// document. A pulled region shows its label on hover and opens its source on click; an
// offered region (a component this prototype declares, not bound and inside no bound
// element) shows its label on hover and does nothing on click.
//
// Every class the layer uses is prefixed av-, and the layer's own elements are reset,
// so a prototype's own rules for .box or .row can never style the layer.
//
// The veil is one path with even-odd holes, never an SVG mask: Chrome does not always
// repaint a masked element when the mask's children change.
import type { BindingsSummary } from "./api.ts";

export const OVERLAY_MARK = "data-aiview-overlay";

export interface OverlayOptions {
  bindings?: BindingsSummary;
  /** A component name to scroll to and flash once the page has loaded (B12). */
  target?: string;
}

/** Drop the date prefix of a prototype file name for the label: `2026-09-03-dock-tools.prototype.html` -> `dock-tools`. */
export const shortName = (file: string): string =>
  file.replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/\.prototype\.html$/, "").replace(/\.html$/, "");

const UI_FONT = "font:12px/1.35 ui-sans-serif,system-ui,sans-serif";

const CSS = `
#__aiview{position:fixed;inset:0;z-index:2147483647;pointer-events:auto;cursor:default}
#__aiview .av-box,#__aiview .av-lbl{background:transparent;border:0;margin:0;padding:0;box-shadow:none;width:auto;height:auto;min-height:0;max-width:none;text-align:left;letter-spacing:normal;text-transform:none}
#__aiview svg{position:absolute;inset:0;width:100%;height:100%}
#__aiview .av-box{position:absolute;outline:2px dashed #4f46e5;outline-offset:1px;border-radius:3px;pointer-events:auto;cursor:pointer}
#__aiview .av-box.av-err{outline-color:#dc2626;pointer-events:none;cursor:default}
#__aiview .av-box.av-decl{outline:1.5px dotted #15803d;cursor:default}
#__aiview .av-box.av-decl .av-lbl{background:#15803d}
#__aiview .av-box:hover{background:rgba(79,70,229,.06)}
#__aiview .av-box.av-decl:hover{background:rgba(21,128,61,.05)}
#__aiview .av-box.av-flash{animation:__aiview-flash 1.2s ease-out 1}
@keyframes __aiview-flash{0%{background:rgba(79,70,229,.35)}100%{background:transparent}}
#__aiview .av-lbl{position:absolute;left:-2px;top:-22px;display:none;pointer-events:auto;cursor:pointer;white-space:nowrap;padding:2px 7px;border-radius:4px;background:#4f46e5;color:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);${UI_FONT}}
#__aiview .av-box.av-err .av-lbl{display:block;background:#dc2626;cursor:default}
#__aiview .av-box:hover .av-lbl{display:block}
`;

// The script is plain, dependency-free browser code. It reads its data from the
// attributes of the layer element so the html stays inert until it runs.
const SCRIPT = `
(function(){
  var layer=document.getElementById('__aiview'); if(!layer) return;
  var target=layer.getAttribute('data-target')||'';
  var short=function(f){return f.replace(/^\\d{4}-\\d{2}-\\d{2}-/,'').replace(/\\.prototype\\.html$/,'').replace(/\\.html$/,'')};
  var svgNS='http://www.w3.org/2000/svg';
  var svg=document.createElementNS(svgNS,'svg');
  svg.innerHTML='<path fill="rgba(255,255,255,.4)" fill-rule="evenodd" d=""/>';
  layer.appendChild(svg);
  var veil=svg.querySelector('path');
  var entries=[];
  function open(file,name){ parent.postMessage({type:'aiview:open',file:file,component:name},'*'); }
  function build(){
    entries.forEach(function(b){b.box.remove()}); entries=[];
    document.querySelectorAll('[data-bound],[data-bound-error]').forEach(function(el){
      var ref=el.getAttribute('data-bound')||el.getAttribute('data-bound-error')||'';
      var isErr=el.hasAttribute('data-bound-error');
      var i=ref.indexOf('#'); var file=i<0?ref:ref.slice(0,i); var name=i<0?'':ref.slice(i+1);
      var box=document.createElement('div'); box.className='av-box'+(isErr?' av-err':'');
      var lbl=document.createElement('span'); lbl.className='av-lbl';
      lbl.textContent=isErr?(el.textContent||ref):(short(file)+' \\u00b7 '+name+' \\u00b7 pulled');
      if(!isErr) box.addEventListener('click',function(ev){ev.stopPropagation();open(file,name)});
      box.appendChild(lbl); layer.appendChild(box);
      entries.push({el:el,box:box,err:isErr,visible:false});
    });
    document.querySelectorAll('[data-component]').forEach(function(el){
      if(el.hasAttribute('data-bound')||el.hasAttribute('data-bound-error')||el.closest('[data-bound]')||layer.contains(el)) return;
      var box=document.createElement('div'); box.className='av-box av-decl';
      var lbl=document.createElement('span'); lbl.className='av-lbl'; lbl.textContent=el.getAttribute('data-component')+' \\u00b7 offered';
      box.addEventListener('click',function(ev){ev.stopPropagation()});
      box.appendChild(lbl); layer.appendChild(box);
      entries.push({el:el,box:box,err:false,visible:false});
    });
    place();
  }
  function place(){
    var d='M0 0H'+innerWidth+'V'+innerHeight+'H0Z';
    entries.forEach(function(b){
      var r=b.el.getBoundingClientRect();
      b.visible=!!(r.width||r.height);
      b.box.style.left=r.left+'px'; b.box.style.top=r.top+'px'; b.box.style.width=r.width+'px'; b.box.style.height=r.height+'px';
      b.box.style.display=b.visible?'block':'none';
      if(b.err||!b.visible) return; // pulled and offered alike render at full strength under their outline
      d+='M'+r.left+' '+r.top+'h'+r.width+'v'+r.height+'h'+(-r.width)+'Z';
    });
    veil.setAttribute('d',d);
  }
  var queued=false;
  function schedule(){ if(queued) return; queued=true; requestAnimationFrame(function(){queued=false;place()}); }
  function rebuild(){ if(queued) return; queued=true; requestAnimationFrame(function(){queued=false;build()}); }
  window.addEventListener('resize',schedule); window.addEventListener('scroll',schedule,true);
  // layout settles after the script ran: measure again on load, when fonts arrive, and once more a moment later
  window.addEventListener('load',schedule); if(document.fonts&&document.fonts.ready) document.fonts.ready.then(schedule); setTimeout(schedule,400);
  new MutationObserver(function(muts){
    for(var i=0;i<muts.length;i++){ if(layer.contains(muts[i].target)) continue; rebuild(); return; }
  }).observe(document.body,{subtree:true,childList:true,attributes:true,characterData:true});
  build();
  if(target){
    var t=document.querySelector('[data-component="'+target.replace(/"/g,'')+'"]');
    if(t){ t.scrollIntoView({block:'center'}); var fb=document.createElement('div'); fb.className='av-box av-flash'; layer.appendChild(fb);
      var r=t.getBoundingClientRect(); fb.style.left=r.left+'px'; fb.style.top=r.top+'px'; fb.style.width=r.width+'px'; fb.style.height=r.height+'px';
      setTimeout(function(){fb.remove()},1300); }
  }
})();
`;

const attr = (s: string): string => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** The served html with the composition layer appended. Idempotent on the marker. */
export function withOverlay(html: string, { bindings, target }: OverlayOptions = {}): string {
  const summary = JSON.stringify(bindings ?? { sources: [], errors: [], warnings: [] });
  const snippet =
    `<style ${OVERLAY_MARK}>${CSS}</style>` +
    `<div id="__aiview" ${OVERLAY_MARK} data-summary="${attr(summary)}"${target ? ` data-target="${attr(target)}"` : ""}></div>` +
    `<script ${OVERLAY_MARK}>${SCRIPT}</script>`;
  const i = html.lastIndexOf("</body>");
  return i < 0 ? html + snippet : html.slice(0, i) + snippet + html.slice(i);
}
