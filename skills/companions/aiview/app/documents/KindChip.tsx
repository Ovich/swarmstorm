import { cn, kindColor } from "../lib/utils.ts";

/** Colored kind chip — hue and chroma come from the hand-placed palette in `utils.ts`,
 *  so two kinds a reader sees side by side never look alike.
 *  NOT a Badge: its colors are data-driven. */
export function KindChip({
  kind,
  dim = false,
  onClick,
}: {
  kind: string;
  /** Rendered de-emphasised (filtered out). */
  dim?: boolean;
  onClick?: () => void;
}) {
  const { h, s: sat, tone } = kindColor(kind);
  const Tag = onClick ? "button" : "span";
  // The tone is the second channel: a strong chip is filled, a light one tinted, so two
  // kinds one spoke apart on the wheel still differ at a glance. Both keep the same
  // text contrast in either theme.
  const style =
    tone === "strong"
      ? {
          background: `light-dark(hsl(${h} ${sat}% 80%), hsl(${h} ${Math.round(sat * 0.7)}% 32%))`,
          color: `light-dark(hsl(${h} ${Math.round(sat * 1.1)}% 22%), hsl(${h} ${sat}% 90%))`,
          borderColor: `light-dark(hsl(${h} ${sat}% 58%), hsl(${h} ${Math.round(sat * 0.7)}% 46%))`,
        }
      : {
          background: `light-dark(hsl(${h} ${sat}% 94%), hsl(${h} ${Math.round(sat * 0.6)}% 17%))`,
          color: `light-dark(hsl(${h} ${Math.round(sat * 1.1)}% 31%), hsl(${h} ${Math.round(sat * 1.15)}% 78%))`,
          borderColor: `light-dark(hsl(${h} ${Math.round(sat * 0.8)}% 82%), hsl(${h} ${Math.round(sat * 0.55)}% 28%))`,
        };
  return (
    <Tag
      onClick={onClick}
      data-component="KindChip"
      data-tone={tone}
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-[7px] text-[11px] font-medium leading-[18px]",
        // Without a handler the chip is decoration sitting on top of a clickable row,
        // so it must not be an event target at all: the click belongs to the row.
        onClick ? "cursor-pointer" : "pointer-events-none",
        dim && "opacity-40",
      )}
      style={style}
    >
      {kind}
    </Tag>
  );
}
