/** An error with an HTTP status — `handle()` (src/server/auth.ts) turns it into the JSON answer.
 *  Its own module so code that must not open the DB (storage, pure tests) can throw it. */
export class HttpError extends Error {
  /** `details` is passed through to the JSON body (e.g. 409 conflicts the UI can act on) */
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** handle()'s answer to input the DB cannot take (pg 22xxx) or a malformed %-escape — any operation's 400 */
export const BAD_INPUT = 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบแล้วลองใหม่';

/**
 * Optimistic locking (drizzle/0026 row_version): `sent` is the version the edit form loaded,
 * `current` the row's version read under FOR UPDATE. Another save in between → 409, nothing
 * written. A request without a version (older client / script) is last-write-wins.
 */
export function assertVersion(sent: unknown, current: number) {
  if (sent === undefined || sent === null || sent === '') return;
  if (Number(sent) !== current)
    throw new HttpError(409, 'มีผู้อื่นแก้ไขเอกสารนี้ไปแล้ว กรุณาโหลดใหม่', { stale: true });
}
