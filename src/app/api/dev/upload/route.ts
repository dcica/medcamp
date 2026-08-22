import { NextRequest, NextResponse } from "next/server";
import { assertSafeObjectPath, localUploadRoot, SONG_MAX_BYTES } from "@/lib/storage";

/**
 * DEV-ONLY: the destination the local-disk storage adapter points its signed
 * upload URLs at, so the browser's upload code path is byte-for-byte the same
 * locally as it is against Supabase (PUT the file to a URL you were handed).
 * Disabled in prod, like the rest of api/dev.
 *
 * PUT /api/dev/upload?bucket=<b>&path=<objectPath>   body: the file
 * GET /api/dev/upload?bucket=<b>&path=<objectPath>   → the file back (stands in
 *   for a signed download URL, and for a public banner URL)
 */

function disabled() {
  return NextResponse.json({ error: "disabled in production" }, { status: 404 });
}

/** Rejects `..` and anything outside the expected id/token shape. */
function resolvePath(req: NextRequest): string | null {
  const raw = req.nextUrl.searchParams.get("path");
  if (!raw) return null;
  try {
    assertSafeObjectPath(raw);
    return raw;
  } catch {
    return null;
  }
}

/** Buckets are a closed set; anything else would be a directory of its own. */
function resolveBucket(req: NextRequest): string | null {
  const b = req.nextUrl.searchParams.get("bucket");
  return b === "songs" || b === "banners" ? b : null;
}

const CONTENT_TYPE: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export async function PUT(req: NextRequest) {
  if (process.env.NODE_ENV === "production") return disabled();

  const path = resolvePath(req);
  const bucket = resolveBucket(req);
  if (!path || !bucket) {
    return NextResponse.json({ error: "invalid or missing bucket/path" }, { status: 400 });
  }

  const body = await req.arrayBuffer();
  // The bucket enforces this in production; enforcing it here too keeps the two
  // environments failing the same way, which is the point of the local adapter.
  if (body.byteLength > SONG_MAX_BYTES) {
    return NextResponse.json(
      { error: "too large", maxBytes: SONG_MAX_BYTES, gotBytes: body.byteLength },
      { status: 413 },
    );
  }

  const { mkdir, writeFile } = await import("node:fs/promises");
  const { join, dirname } = await import("node:path");
  const full = join(process.cwd(), localUploadRoot(), bucket, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, Buffer.from(body));

  return NextResponse.json({ ok: true, bucket, path, sizeBytes: body.byteLength });
}

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production") return disabled();

  const path = resolvePath(req);
  const bucket = resolveBucket(req);
  if (!path || !bucket) {
    return NextResponse.json({ error: "invalid or missing bucket/path" }, { status: 400 });
  }

  const { readFile } = await import("node:fs/promises");
  const { join, extname } = await import("node:path");
  try {
    const data = await readFile(join(process.cwd(), localUploadRoot(), bucket, path));
    const type = CONTENT_TYPE[extname(path).toLowerCase()] ?? "application/octet-stream";
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": type,
        // Banners are meant to render inline — that is the whole point of a
        // public bucket. Songs are always an attachment, matching the production
        // adapter: `allowed_mime_types` checks the DECLARED type, so anything
        // served inline from our own origin is a stored-XSS vector.
        ...(bucket === "banners"
          ? {}
          : { "Content-Disposition": `attachment; filename="song.mp3"` }),
      },
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
