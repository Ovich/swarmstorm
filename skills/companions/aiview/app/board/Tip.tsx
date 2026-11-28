import { useEffect, useRef } from "react";

/** The one floating box of the page (D9): the text of the hovered or focused `[data-tip]`, placed
 *  under it, or above it near the bottom of the view. Fixed to the viewport, so no `overflow`
 *  container clips it. */
export function TipLayer() {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const hide = (): void => {
      el.hidden = true;
    };
    const show = (target: EventTarget | null): void => {
      const anchor = target instanceof Element ? target.closest<HTMLElement>("[data-tip]") : null;
      const text = anchor?.dataset.tip;
      if (!anchor || !text) return hide();
      el.textContent = text;
      el.hidden = false;
      const r = anchor.getBoundingClientRect();
      el.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - el.offsetWidth - 8))}px`;
      const below = r.bottom + 6;
      el.style.top = `${below + el.offsetHeight > window.innerHeight ? r.top - el.offsetHeight - 6 : below}px`;
    };
    const onOver = (ev: Event): void => show(ev.target);
    const onOut = (ev: MouseEvent): void => {
      const to = ev.relatedTarget instanceof Element ? ev.relatedTarget.closest("[data-tip]") : null;
      if (!to) hide();
    };
    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    document.addEventListener("focusin", onOver);
    document.addEventListener("focusout", hide);
    window.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
      document.removeEventListener("focusin", onOver);
      document.removeEventListener("focusout", hide);
      window.removeEventListener("scroll", hide, true);
    };
  }, []);
  return <div id="tipbox" ref={box} role="tooltip" hidden data-component="TipLayer" />;
}
