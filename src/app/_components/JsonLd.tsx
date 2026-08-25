import { jsonLdScript } from "@/lib/seo";

/**
 * One `<script type="application/ld+json">` block.
 *
 * `dangerouslySetInnerHTML` is unavoidable here — React escapes text children
 * for HTML, which would turn every `"` in the JSON into `&quot;` and hand
 * Google a document that does not parse. The safety therefore has to come from
 * the serialiser instead, which is why `jsonLdScript` and not `JSON.stringify`:
 * it escapes `<`, `>` and `&`, so a coordinator who types `</script>` into an
 * event description cannot close this element. See the comment on that function.
 *
 * A server component with no interactivity, so this costs nothing on the client.
 */
export function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: jsonLdScript(data) }}
    />
  );
}
