/** A member's context size as the board reads it from its transcript (product-shape#D5): its tokens and when they
 *  were read, ms epoch; null when the board has none. */
export type MemberContext = { tokens: number; at: number } | null;

/** The roster's word for a context size, k-rounded: `context 142k`; under a thousand tokens, the count itself. */
export function contextSizeText(tokens: number): string {
  return tokens < 1000 ? `context ${tokens}` : `context ${Math.round(tokens / 1000)}k`;
}
