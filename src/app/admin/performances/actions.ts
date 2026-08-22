"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/admin";
import { setSongReady, songDownloadUrl } from "@/server/performance";

/**
 * Coordinator actions on the performance roster.
 *
 * Every one re-checks requireAdmin: the layout gates the /admin tree, but a
 * server action is its own entry point and is reachable without ever rendering
 * that layout. Gating only at the page would leave these callable by anyone who
 * knows the action id.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Mark that a playable, prepared cut is in hand — the gate on the running order.
 * Deliberately a human attestation rather than something inferred from an upload
 * existing: a correct MP3 in a bucket is the input to show prep, not the result.
 */
export async function setSongReadyAction(
  entryId: string,
  ready: boolean,
): Promise<ActionResult> {
  try {
    await requireAdmin();
    await setSongReady(entryId, ready);
    revalidatePath("/admin/performances");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not update that entry.",
    };
  }
}

export type DownloadResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * A short-lived signed link to one group's track. Minted on demand rather than
 * rendered into the page, so a roster left open on a laptop does not contain
 * live download URLs for every entry.
 */
export async function songDownloadUrlAction(
  entryId: string,
): Promise<DownloadResult> {
  try {
    await requireAdmin();
    const url = await songDownloadUrl(entryId);
    if (!url) {
      return { ok: false, error: "No file has been uploaded for this entry." };
    }
    return { ok: true, url };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not build a link.",
    };
  }
}
