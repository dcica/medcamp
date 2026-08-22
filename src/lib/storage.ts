import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";

/**
 * Pluggable object storage (Platform-Mandate §6), for files the public uploads —
 * today only competition song tracks.
 *
 * WHY a seam and not a direct Supabase call: production runs Postgres on
 * Supabase, but local dev is Docker Postgres with no Supabase project at all,
 * and a self-hoster may bring plain Postgres and MinIO. Email already
 * establishes this shape (src/lib/email.ts): a real provider when configured, a
 * degraded local path when not, and never a crash.
 *
 * WHY the browser uploads straight to the provider rather than POSTing through a
 * route handler: a 10 MiB body would occupy serverless memory and billed time
 * for the whole transfer, and would sit against the platform's request-body
 * limit. `createSignedUpload` hands the browser a single-use, single-path URL
 * and our function is out of the byte path entirely.
 *
 * The consequence of being out of the byte path is that WE CANNOT INSPECT THE
 * FILE. Size and type are therefore enforced by the bucket itself (see
 * docs/superpowers/specs/2026-08-20-performance-entry-design.md), and
 * `statObject` exists so the server can verify what actually landed instead of
 * trusting the client's "done" call.
 */

/** 10 MiB. Mirror of the bucket's `file_size_limit`; both must agree. */
export const SONG_MAX_BYTES = 10 * 1024 * 1024;

/** The only accepted track format. Mirror of the bucket's `allowed_mime_types`. */
export const SONG_CONTENT_TYPE = "audio/mpeg";

/**
 * 5 MiB. Smaller than a song on purpose: a banner is decoded and laid out on
 * every visit to the public events page, much of it on phone data, whereas a
 * track is fetched once by one coordinator.
 */
export const BANNER_MAX_BYTES = 5 * 1024 * 1024;

/** Formats next/image handles well. No SVG: it is a script-execution vector. */
export const BANNER_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Buckets whose objects are world-readable. Everything else is signed-only. */
const PUBLIC_BUCKETS = new Set<string>(["banners"]);

function assertPublicBucket(bucket: string): void {
  if (!PUBLIC_BUCKETS.has(bucket)) {
    throw new Error(
      `publicUrl() called for private bucket "${bucket}" — a permanent link to a private object is a bug.`,
    );
  }
}

export type SignedUpload = {
  /** Where the browser PUTs the bytes. */
  url: string;
  /** Provider upload token, when the provider needs it alongside the URL. */
  token?: string;
  /** The object path the URL is scoped to. */
  path: string;
};

export type ObjectInfo = {
  path: string;
  sizeBytes: number;
  contentType: string | null;
};

export interface StorageAdapter {
  /** Identifies the adapter in logs; also what the UI reports when degraded. */
  readonly name: string;
  createSignedUpload(
    bucket: StorageBucket,
    path: string,
    contentType: string,
  ): Promise<SignedUpload>;
  /** Null when the object is absent — i.e. the client lied about uploading. */
  statObject(bucket: StorageBucket, path: string): Promise<ObjectInfo | null>;
  /**
   * Short-lived read URL. Always forces a download rather than inline
   * rendering: `allowed_mime_types` validates the DECLARED content type, so a
   * mislabeled file can land, and anything served inline from our own origin is
   * a stored-XSS vector.
   */
  createSignedDownload(
    bucket: StorageBucket,
    path: string,
    expiresInSeconds: number,
    filename: string,
  ): Promise<string>;
  /**
   * A stable, cacheable URL for a PUBLIC bucket. Throws for a private one —
   * asking for a permanent link to a private object is a bug, not a fallback.
   */
  publicUrl(bucket: StorageBucket, path: string): string;
  deleteObject(bucket: StorageBucket, path: string): Promise<void>;
}

/**
 * Object paths are built from internal ids (`{orgId}/{eventId}/{entryId}/{token}.mp3`),
 * never from user input — so this should never fire. It is here because a path
 * reaches both a URL query string and, in the local adapter, the filesystem: a
 * single `..` segment would turn a storage write into an arbitrary file write.
 * Cheap assertion at the one chokepoint every adapter shares.
 */
export function assertSafeObjectPath(path: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9/_-]*\.(mp3|jpg|jpeg|png|webp)$/.test(path) || path.includes("..")) {
    throw new Error(`Unsafe storage object path: ${JSON.stringify(path)}`);
  }
}

// ── Supabase Storage ─────────────────────────────────────────────────────────

/**
 * TWO buckets, because the two things stored have opposite access models and one
 * bucket cannot be both.
 *
 *   songs   — PRIVATE. A group's performance track. Read only through a
 *             short-lived signed URL, always as an attachment (see
 *             createSignedDownload). `allowed_mime_types` validates the
 *             DECLARED type, so a mislabeled file can land; anything served
 *             inline from our own origin would be stored XSS.
 *   banners — PUBLIC. Event artwork rendered on the public events page to
 *             anonymous visitors. A signed URL would expire mid-page and cannot
 *             be cached by next/image.
 *
 * Collapsing these into one bucket with a path policy is possible and a worse
 * idea: one misconfigured rule would expose every entrant's track.
 */
const BUCKETS = {
  songs: env.SUPABASE_STORAGE_BUCKET,
  banners: env.SUPABASE_BANNER_BUCKET,
} as const;

export type StorageBucket = keyof typeof BUCKETS;

let serviceClient: SupabaseClient | null = null;

/**
 * Service-role client. Bypasses RLS, so it is server-only and must never be
 * handed to the browser — unlike createRealtimeClient() in src/lib/supabase.ts,
 * which is deliberately anon-key and read-only.
 */
function getServiceClient(): SupabaseClient {
  if (!serviceClient) {
    serviceClient = createClient(
      env.NEXT_PUBLIC_SUPABASE_URL as string,
      env.SUPABASE_SERVICE_ROLE_KEY as string,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return serviceClient;
}

const supabaseAdapter: StorageAdapter = {
  name: "supabase",

  async createSignedUpload(bucket, path) {
    assertSafeObjectPath(path);
    const { data, error } = await getServiceClient()
      .storage.from(BUCKETS[bucket])
      .createSignedUploadUrl(path);
    if (error || !data) {
      throw new Error(`Signed upload URL failed: ${error?.message ?? "no data"}`);
    }
    return { url: data.signedUrl, token: data.token, path };
  },

  async statObject(bucket, path) {
    assertSafeObjectPath(path);
    // `list` with a search on the basename rather than `info`: list has been
    // stable across supabase-js v2 for the whole time this project has pinned
    // it, and returns the size we need to re-check against SONG_MAX_BYTES.
    const cut = path.lastIndexOf("/");
    const dir = cut === -1 ? "" : path.slice(0, cut);
    const base = cut === -1 ? path : path.slice(cut + 1);
    const { data, error } = await getServiceClient()
      .storage.from(BUCKETS[bucket])
      .list(dir, { search: base, limit: 100 });
    if (error) throw new Error(`Stat failed: ${error.message}`);
    // `search` is a prefix match, so confirm the exact name before trusting it.
    const hit = data?.find((o) => o.name === base);
    if (!hit) return null;
    return {
      path,
      sizeBytes: Number(hit.metadata?.size ?? 0),
      contentType: (hit.metadata?.mimetype as string | undefined) ?? null,
    };
  },

  async createSignedDownload(bucket, path, expiresInSeconds, filename) {
    assertSafeObjectPath(path);
    const { data, error } = await getServiceClient()
      .storage.from(BUCKETS[bucket])
      // `download` sets Content-Disposition: attachment — see the interface note.
      .createSignedUrl(path, expiresInSeconds, { download: filename });
    if (error || !data) {
      throw new Error(`Signed download URL failed: ${error?.message ?? "no data"}`);
    }
    return data.signedUrl;
  },

  async deleteObject(bucket, path) {
    assertSafeObjectPath(path);
    const { error } = await getServiceClient().storage.from(BUCKETS[bucket]).remove([path]);
    if (error) throw new Error(`Delete failed: ${error.message}`);
  },

  publicUrl(bucket, path) {
    assertPublicBucket(bucket);
    assertSafeObjectPath(path);
    return getServiceClient().storage.from(BUCKETS[bucket]).getPublicUrl(path)
      .data.publicUrl;
  },
};

// ── Local disk (development only) ────────────────────────────────────────────

/**
 * Keeps the CLIENT code path identical to production: the browser still asks for
 * a URL and still PUTs the bytes to it. Only the URL differs — here it points at
 * our own dev-only route (/api/dev/upload), which 404s when NODE_ENV is
 * production, like every other route under api/dev.
 *
 * Without this, the upload flow would be untestable without a Supabase project,
 * and the one bug class this design is most exposed to — a mismatch between what
 * the browser sends and what the server later verifies — is exactly the kind
 * that only shows up when you actually run it.
 */
const LOCAL_DIR = ".uploads";

const localDiskAdapter: StorageAdapter = {
  name: "local-disk",

  async createSignedUpload(bucket, path) {
    assertSafeObjectPath(path);
    return {
      url: `/api/dev/upload?bucket=${bucket}&path=${encodeURIComponent(path)}`,
      path,
    };
  },

  async statObject(bucket, path) {
    assertSafeObjectPath(path);
    const { stat } = await import("node:fs/promises");
    const { join } = await import("node:path");
    try {
      const info = await stat(join(process.cwd(), LOCAL_DIR, bucket, path));
      // Type is not recoverable from disk; the dev route only writes what the
      // browser declared, and prod is the case that matters for enforcement.
      return { path, sizeBytes: info.size, contentType: null };
    } catch {
      return null;
    }
  },

  async createSignedDownload(bucket, path) {
    assertSafeObjectPath(path);
    return `/api/dev/upload?bucket=${bucket}&path=${encodeURIComponent(path)}`;
  },

  publicUrl(bucket, path) {
    assertPublicBucket(bucket);
    assertSafeObjectPath(path);
    return `/api/dev/upload?bucket=${bucket}&path=${encodeURIComponent(path)}`;
  },

  async deleteObject(bucket, path) {
    assertSafeObjectPath(path);
    const { rm } = await import("node:fs/promises");
    const { join } = await import("node:path");
    await rm(join(process.cwd(), LOCAL_DIR, bucket, path), { force: true });
  },
};

/** Filesystem root for the local adapter. Exported for the dev route. */
export function localUploadRoot(): string {
  return LOCAL_DIR;
}

// ── Selection ────────────────────────────────────────────────────────────────

const supabaseConfigured = Boolean(
  env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY,
);

/**
 * The active adapter, or null when uploads are unavailable.
 *
 * Null is a supported state, not a failure: an unconfigured production tenant
 * still takes entries, with every entrant choosing the OFFLINE delivery option.
 * A missing bucket must not take registration down.
 */
export function getStorage(): StorageAdapter | null {
  if (supabaseConfigured) return supabaseAdapter;
  if (process.env.NODE_ENV !== "production") return localDiskAdapter;
  return null;
}

/** Whether the UI should offer file upload at all (vs. offline-only). */
export function uploadsEnabled(): boolean {
  return getStorage() !== null;
}

if (!supabaseConfigured && process.env.NODE_ENV === "production") {
  log.warn("storage: no provider configured — song uploads disabled", {
    hint: "set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
  });
}
