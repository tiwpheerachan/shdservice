import "server-only";
import type { z } from "zod";
import { HttpError } from "@/server/auth";
import { summary, validate } from "@/lib/validation";

/**
 * Run a form schema from src/lib/validation on an API payload (the same rules the page ran).
 * Fails with 400 "กรอกข้อมูลไม่ครบ N ช่อง" + { fields } — the page shows each under its box.
 */
export function assertValid<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const v = validate(schema, data);
  if (!v.ok) throw new HttpError(400, summary(v.errors), { fields: v.errors });
  return v.data;
}
