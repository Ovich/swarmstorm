// Pointing: the components the agent is asking about, lit on the page. The agent runs
// `aiview show`, the viewer receives the names (src/prototype/pointer.ts) and posts them into
// the frame; the script below dims the rest of the page and outlines each named
// component with its name on it, so the word in the question and the thing on the screen
// are the same word.
//
// Unlike Composition (overlay.ts) the layer takes no pointer event: the person is asked
// about a screen they can still operate. It is driven by a message rather than baked
// into the html, so pointing somewhere else does not reload the frame and the prototype
// keeps the state the person put it in. The highlight stays until the next message; an
// empty list of names removes it.
//
// Every class is prefixed av-, and the veil is one even-odd path, for overlay.ts's reasons.
export const SPOTLIGHT_MARK = "data-aiview-spotlight";

const UI_FONT = "font:600 12px/1.35 ui-sans-serif,system-ui,sans-serif";

const CSS = `
#__aiview_point{position:fixed;inset:0;z-index:2147483647;pointer-events:none}
#__aiview_point svg{position:absolute;inset:0;width:100%;height:100%}
#__aiview_point .av-pt{position:absolute;margin:0;padding:0;border:0;background:transparent;outline:2px solid #4f46e5;outline-offset:2px;border-radius:4px;box-shadow:0 0 0 5px rgba(79,70,229,.22)}
#__aiview_point .av-pt-lbl{position:absolute;left:-4px;top:-26px;white-space:nowrap;margin:0;padding:3px 8px;border:0;border-radius:4px;background:#4f46e5;color:#fff;letter-spacing:normal;text-transform:none;box-shadow:0 1px 3px rgba(0,0,0,.3);${UI_FONT}}
`;

const SCRIPT = `
(function(){
  var names=[], entries=[], layer=null, veil=null, scrolled=true, queued=false;
  var svgNS='http://www.w3.org/2000/svg';
  function clear(){ if(layer){layer.remove();layer=null;veil=null} entries=[]; }
  function build(){
    clear(); if(!names.length) return;
    layer=document.createElement('div'); layer.id='__aiview_point'; layer.setAttribute('${SPOTLIGHT_MARK}','');
    var svg=document.createElementNS(svgNS,'svg');
    svg.innerHTML='<path fill="rgba(15,23,42,.5)" fill-rule="evenodd" d=""/>';
    layer.appendChild(svg); veil=svg.querySelector('path');
    names.forEach(function(name){
      var first=true;
      document.querySelectorAll('[data-component="'+name+'"]').forEach(function(el){
        var box=document.createElement('div'); box.className='av-pt';
        var lbl=null;
        if(first){ lbl=document.createElement('span'); lbl.className='av-pt-lbl'; lbl.textContent=name; box.appendChild(lbl); first=false; }
        layer.appendChild(box); entries.push({el:el,box:box,lbl:lbl});
      });
    });
    document.body.appendChild(layer);
    place();
  }
  function place(){
    if(!layer) return;
    var d='M0 0H'+innerWidth+'V'+innerHeight+'H0Z', seen=null, taken=[];
    entries.forEach(function(b){
      var r=b.el.getBoundingClientRect(); var visible=!!(r.width||r.height);
      b.box.style.display=visible?'block':'none'; if(!visible) return;
      if(!seen) seen=b.el;
      b.box.style.left=r.left+'px'; b.box.style.top=r.top+'px'; b.box.style.width=r.width+'px'; b.box.style.height=r.height+'px';
      if(b.lbl) label(b.lbl,r,taken);
      d+='M'+r.left+' '+r.top+'h'+r.width+'v'+r.height+'h'+(-r.width)+'Z';
    });
    // nothing to show yet (a variant still switching): no veil, or the whole page goes dark
    veil.setAttribute('d',seen?d:'');
    if(seen&&!scrolled){ scrolled=true; seen.scrollIntoView({block:'center',behavior:'smooth'}); }
  }
  // A label sits above its box, below it when the top of the page is in the way, and
  // further down still when another label is already there: two components side by side
  // would otherwise be named on top of each other. Never inside: it would hide the thing.
  function label(lbl,r,taken){
    var tries=[-26,r.height+6,r.height+32,r.height+58];
    for(var i=0;i<tries.length;i++){
      if(tries[i]<0&&r.top<30) continue;
      lbl.style.top=tries[i]+'px';
      var l=lbl.getBoundingClientRect();
      var hit=taken.some(function(t){return l.left<t.right&&l.right>t.left&&l.top<t.bottom&&l.bottom>t.top});
      if(!hit){ taken.push(l); return; }
    }
    taken.push(lbl.getBoundingClientRect());
  }
  function schedule(){ if(queued) return; queued=true; requestAnimationFrame(function(){queued=false;place()}); }
  function rebuild(){ if(queued) return; queued=true; requestAnimationFrame(function(){queued=false;build()}); }
  window.addEventListener('message',function(e){
    var d=e.data||{}; if(d.type!=='aiview:point'||!Array.isArray(d.names)) return;
    names=d.names.filter(function(n){return typeof n==='string'&&/^[\\w.-]+$/.test(n)});
    scrolled=false; build();
  });
  window.addEventListener('resize',schedule); window.addEventListener('scroll',schedule,true);
  window.addEventListener('load',schedule); if(document.fonts&&document.fonts.ready) document.fonts.ready.then(schedule);
  // the layer's own coming and going is a mutation of body too: counted, it would rebuild forever
  function mine(m){
    if(layer&&layer.contains(m.target)) return true;
    // Composition's layer redraws when this one appears; answering that would loop the two
    var comp=document.getElementById('__aiview'); if(comp&&comp.contains(m.target)) return true;
    if(m.type!=='childList') return false;
    var nodes=[].slice.call(m.addedNodes).concat([].slice.call(m.removedNodes));
    return nodes.length>0&&nodes.every(function(n){return n.nodeType===1&&n.hasAttribute('${SPOTLIGHT_MARK}')});
  }
  new MutationObserver(function(muts){
    if(!names.length) return;
    for(var i=0;i<muts.length;i++){ if(mine(muts[i])) continue; rebuild(); return; }
  }).observe(document.documentElement,{subtree:true,childList:true,attributes:true});
})();
`;

/** The message that lights `names` in a frame served through `withSpotlight`. */
export const pointMessage = (names: readonly string[]): { type: "aiview:point"; names: string[] } => ({
  type: "aiview:point",
  names: [...names],
});

/** The served html with the spotlight installed and idle. Idempotent on the marker. */
export function withSpotlight(html: string): string {
  if (html.includes(SPOTLIGHT_MARK)) return html;
  const snippet = `<style ${SPOTLIGHT_MARK}>${CSS}</style><script ${SPOTLIGHT_MARK}>${SCRIPT}</script>`;
  const i = html.lastIndexOf("</body>");
  return i < 0 ? html + snippet : html.slice(0, i) + snippet + html.slice(i);
}
