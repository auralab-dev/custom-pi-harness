/**
 * Dependency-free token estimate for deciding whether rendered Markdown should
 * be returned inline or materialized to disk.
 *
 * This is intentionally conservative for punctuation-heavy text and non-ASCII
 * content. It is a delivery guard, not a billing/tokenizer implementation.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  let asciiChars = 0;
  let nonAsciiCodePoints = 0;
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) asciiChars += 1;
    else nonAsciiCodePoints += 1;
  }

  const characterEstimate = asciiChars / 3.5 + nonAsciiCodePoints / 1.2;
  const lexicalUnits = text.match(/\S+/g)?.length ?? 0;
  const lexicalEstimate = lexicalUnits * 1.5;

  return Math.ceil(Math.max(characterEstimate, lexicalEstimate));
}
