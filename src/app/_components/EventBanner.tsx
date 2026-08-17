import Image from "next/image";

/**
 * Event banner — renders a tenant's promo artwork the way the tenant authored it.
 *
 * dcica publishes events as portrait posters with the title, date, venue, price
 * and contact baked into the image (Dandiya 643x803 = 0.80, Diwali_Flyer_2026
 * 643x922 = 0.70), and dcica.org renders them uncropped at natural ratio. A
 * fixed landscape frame with object-cover would slice the title and date off the
 * poster, so this component never crops: width is constrained, height follows
 * the image.
 *
 * `width`/`height` below are only a pre-load aspect placeholder — `h-auto w-full`
 * hands layout back to the image's true ratio once it loads. The placeholder is
 * 4:5 because that is the middle of the poster range dcica actually ships, which
 * keeps the load-time shift small for the common case.
 */
export function EventBanner({
  src,
  alt,
  variant = "card",
}: {
  src: string;
  alt: string;
  /**
   * `card` fills the event card's width. `compact` caps the poster on form pages
   * so a tall flyer doesn't push the actual form below the fold.
   */
  variant?: "card" | "compact";
}) {
  return (
    <div
      className={
        variant === "compact"
          ? "mx-auto w-full max-w-[15rem]"
          : "w-full bg-gray-50"
      }
    >
      <Image
        src={src}
        alt={alt}
        width={800}
        height={1000}
        sizes={
          variant === "compact"
            ? "240px"
            : "(min-width: 640px) 50vw, 100vw"
        }
        // The card variant sits inside an `overflow-hidden rounded-xl` card that
        // already clips the corners; a second 8px radius here just exposes a
        // sliver of wrapper at the top corners. Compact has no clipping parent,
        // so it keeps its own radius.
        className={
          variant === "compact" ? "h-auto w-full rounded-lg" : "h-auto w-full"
        }
      />
    </div>
  );
}
