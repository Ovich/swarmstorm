/** The roster's word for a member's context size (product-shape#D5), k-rounded: `context 142k`; under a thousand
 *  tokens, the count itself. */
export function contextSizeText(tokens: number): string {
  return tokens < 1000 ? `context ${tokens}` : `context ${Math.round(tokens / 1000)}k`;
}
