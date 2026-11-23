"use client";

import { useState } from "react";

/**
 * Rasterise the flyer SVG to a 1024px PNG in the browser.
 *
 * The SVG carries the tenant logo as an embedded data URI, and the repo has no
 * server-side image library, so the browser — which already renders that SVG on
 * the page — draws it to a canvas. Embedded data URIs do not taint the canvas.
 * `width`/`height` are stamped on first because Firefox will not draw an SVG
 * that has only a viewBox.
 */
export function QrPngDownload({ svg, file }: { svg: string; file: string }) {
  const [failed, setFailed] = useState(false);

  async function download() {
    setFailed(false);
    try {
      const px = 1024;
      const sized = svg.replace("<svg ", `<svg width="${px}" height="${px}" `);
      const img = new Image(px, px);
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sized)}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = px;
      canvas.height = px;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no canvas");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, px, px);
      ctx.drawImage(img, 0, 0, px, px);
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = `${file}.png`;
      a.click();
    } catch {
      setFailed(true);
    }
  }

  return (
    <button
      type="button"
      onClick={download}
      className="flex min-h-tap flex-1 items-center justify-center rounded-md border border-gray-300 text-sm font-medium"
    >
      {failed ? "PNG failed — use SVG" : "PNG"}
    </button>
  );
}
