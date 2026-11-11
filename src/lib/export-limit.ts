/**
 * Most rows one list call returns: the Excel export's cap (src/server/export.ts), and so the ceiling of
 * every unpaged list function. A pure constant, so the services can share it without importing export.ts.
 */
export const MAX_EXPORT_ROWS = 20_000;
