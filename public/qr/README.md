# QR codes — events.dcica.org

Every file here encodes exactly one URL: **https://events.dcica.org**

## Which file to send the designer

| File | Use |
|---|---|
| **`qr-events-dcica-2048.png`** | **Start here.** Print and Canva. 2048×2048, white background. |
| `qr-events-dcica-1024.png` | Same artwork, smaller file. Social posts, email, slides. |
| `qr-events-dcica.svg` | Vector, for Illustrator / Inkscape / a print shop that asks for it. |
| `qr-events-dcica-watermark-2048.png` | Logo screened behind the pattern instead of centred. Scans, but the logo reads as smudging — not recommended. |
| `qr-events-dcica-watermark.svg` | Vector of the same. |

## Canva

**Upload the PNG, not the SVG.** SVG upload needs Canva Pro, and Canva's SVG
importer is unreliable with the embedded logo image these files contain — it can
drop the logo and leave a QR with a hole in the middle. The PNG has no such
problem and prints identically at these resolutions.

## Rules for whoever places it

1. **Do not crop the white margin.** The white band around the pattern is the
   quiet zone. Scanners use it to find the code; trimming it to "tidy up" the
   layout is the single most common way a QR stops working.
2. **Do not recolour, invert, or add a gradient.** Dark modules on a light
   background is what a scanner looks for.
3. **Do not stretch.** Keep it square — scale both dimensions together.
4. **Do not place it on a photo or patterned area.** Put it on a plain light
   panel. If the poster is dark, keep the code's own white background rather
   than knocking it out.
5. **Keep the logo.** It is inside the error-correction budget at this size. If
   anyone enlarges it "to make the brand bigger", the code stops scanning —
   measured, not guessed: 26% coverage still reads and 30% does not. These files
   sit at 24%.

## Size

Tested by decoding the actual files, not estimated:

- **Print:** readable down to 1.5cm at 300dpi. Use **2.5–3cm** on a flyer so it
  scans from a comfortable arm's length, and larger on a banner people read from
  further away.
- **Screen:** use **200px or more**.

Sizes in between can behave oddly — at exactly 160px this code failed to decode
while 120px and 200px both passed, because the 37-module grid landed on
fractional pixels. So: **scan the proof with a phone after placing it**, at the
final size, from the printed piece if possible. Don't rely on the numbers above
once the artwork has been resized in a design tool.

## Regenerating

If the URL ever changes these must all be rebuilt — a QR cannot be edited. The
generator is described in the commit that added this directory.
