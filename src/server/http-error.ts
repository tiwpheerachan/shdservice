/** An error with an HTTP status — `handle()` (src/server/auth.ts) turns it into the JSON answer.
 *  Its own module so code that must not open the DB (storage, pure tests) can throw it. */
export class HttpError extends Error {
  /** `details` is passed through to the JSON body (e.g. 409 conflicts the UI can act on) */
  constructor(
    public status: number,
    message: string,
    public details?: unknown
  ) {
    super(message);
  }
}
