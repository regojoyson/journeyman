import type { Queryable } from "../db.ts";

export type KitRole = "base" | "bundle";

/** Insert-or-update the current image ref for a kit role. */
export async function upsertKitImage(db: Queryable, role: KitRole, imageRef: string): Promise<void> {
  await db.query(
    `INSERT INTO kit_images (role, image_ref, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (role) DO UPDATE SET image_ref = EXCLUDED.image_ref, updated_at = now()`,
    [role, imageRef],
  );
}

/** Current image ref for a role, or null if not registered yet. */
export async function getKitImage(db: Queryable, role: KitRole): Promise<string | null> {
  const { rows } = await db.query(`SELECT image_ref FROM kit_images WHERE role = $1`, [role]);
  return rows[0]?.image_ref ?? null;
}

/**
 * Resolve both kit refs, preferring the DB rows and falling back to the
 * provided defaults (env-derived) when a row is absent.
 */
export async function resolveKitRefs(
  db: Queryable,
  defaults: { base: string; bundle: string },
): Promise<{ base: string; bundle: string }> {
  const [base, bundle] = await Promise.all([getKitImage(db, "base"), getKitImage(db, "bundle")]);
  return { base: base ?? defaults.base, bundle: bundle ?? defaults.bundle };
}
