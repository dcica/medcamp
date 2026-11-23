/**
 * The organisation's privacy policy and terms are TEXT it typed into its
 * settings, rendered on /privacy and /terms. This turns that text into
 * blocks — headings, paragraphs, bullet lists — and nothing else. It never
 * produces HTML and never interprets any: a `<script>` typed into a policy is
 * a paragraph that says `<script>`, because React escapes block text and no
 * dangerouslySetInnerHTML exists on this path. The subset is deliberately
 * tiny; a policy is prose, not a document format.
 *
 *   # Heading / ## Sub-heading / ### Minor heading
 *   - bullet  (or * bullet)
 *   blank line  → paragraph break; adjacent lines join into one paragraph
 */
export type LegalBlock =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] };

export function renderLegalBlocks(text: string): LegalBlock[] {
  const blocks: LegalBlock[] = [];
  let para: string[] = [];
  let list: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push({ kind: "paragraph", text: para.join(" ") });
    para = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ kind: "list", items: list });
    list = [];
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      flushList();
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      flushList();
      blocks.push({ kind: "heading", level: heading[1].length as 1 | 2 | 3, text: heading[2].trim() });
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      flushPara();
      list.push(bullet[1].trim());
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return blocks;
}
