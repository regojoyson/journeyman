import type { Pool } from "pg";
import { countPlatformAdmins, isUserPlatformAdmin, setUserPlatformAdmin } from "./db.ts";

export interface PlatformAdminService {
  isPlatformAdmin(userId: string): Promise<boolean>;
  /** Throws if removing would leave zero active platform admins. */
  setPlatformAdmin(userId: string, value: boolean): Promise<void>;
  count(): Promise<number>;
}

export function makePlatformAdminService(pool: Pool): PlatformAdminService {
  return {
    isPlatformAdmin: (userId) => isUserPlatformAdmin(pool, userId),
    async setPlatformAdmin(userId, value) {
      if (value === false) {
        const target = await isUserPlatformAdmin(pool, userId);
        if (target) {
          const total = await countPlatformAdmins(pool);
          if (total <= 1) {
            throw new Error("Cannot remove last platform admin");
          }
        }
      }
      await setUserPlatformAdmin(pool, userId, value);
    },
    count: () => countPlatformAdmins(pool),
  };
}
