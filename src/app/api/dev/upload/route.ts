import { NextRequest, NextResponse } from "next/server";
import { assertSafeObjectPath, localUploadRoot, SONG_MAX_BYTES } from "@/lib/storage";

/**
 * DEV-ONLY: the destination the local-disk storage adapter points its signed
 * upload URLs at, so the browser's upload code path is byte-for-byte the same
 * locally as it is against Supabase (PUT the file to a URL you were handed).
 * Disabled in prod, like the rest of api/dev.
 *
 * PUT /api/dev/upload?path=<objectPath>   body: the file
 * GET /api/dev/upload?path=<objectPath>   → the file back (stands in for a
 *                                           signed download URL)
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

export async function PUT(req: NextRequest) {
  if (process.env.NODE_ENV === "production") return disabled();

  const path = resolvePath(req);
  if (!path) {
    return NextResponse.json({ error: "invalid or missing path" }, { status: 400 });
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
  const full = join(process.cwd(), localUploadRoot(), path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, Buffer.from(body));

  return NextResponse.json({ ok: true, path, sizeBytes: body.byteLength });
}

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production") return disabled();

  const path = resolvePath(req);
  if (!path) {
    return NextResponse.json({ error: "invalid or missing path" }, { status: 400 });
  }

  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  try {
    const data = await readFile(join(process.cwd(), localUploadRoot(), path));
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": "audio/mpeg",
        // Matches the production adapter, which always signs downloads as
        // attachments — never render an uploaded file inline on our own origin.
        "Content-Disposition": `attachment; filename="song.mp3"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
