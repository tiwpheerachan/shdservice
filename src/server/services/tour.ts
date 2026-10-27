import 'server-only';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { appUserTour } from '@/db/schema';

export type TourState = { seen: string[]; off: boolean };

/** which บทสอน this user has been offered (no row = none yet) */
export async function tourState(userId: number): Promise<TourState> {
  const [r] = await db
    .select({ seen: appUserTour.seen, off: appUserTour.off })
    .from(appUserTour)
    .where(eq(appUserTour.userId, userId));
  return r ?? { seen: [], off: false };
}

/** a page's offer answered (`seen`) / never ask again (`off`) — one statement, so two tabs both land */
export async function saveTour(userId: number, change: { seen?: string; off?: boolean }): Promise<void> {
  await db
    .insert(appUserTour)
    .values({ userId, seen: change.seen ? [change.seen] : [], off: change.off ?? false })
    .onConflictDoUpdate({
      target: appUserTour.userId,
      set: {
        // the path once (a page has one tour; the app ~40 pages)
        seen: change.seen
          ? sql`array_append(array_remove(${appUserTour.seen}, ${change.seen}::text), ${change.seen}::text)`
          : appUserTour.seen,
        off: change.off ?? appUserTour.off,
        updatedAt: sql`now()`,
      },
    });
}
