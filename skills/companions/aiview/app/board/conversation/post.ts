/** A `#<n>` reference: not glued to a word before it, digits only after. */
export const SEQ_REF = /(?<![\w#])#(\d+)(?![\w])/g;

/** The `#<n>` references in a text, as seqs, in order. */
export function seqRefs(text: string): number[] {
  return [...text.matchAll(SEQ_REF)].map((m) => Number(m[1]));
}
