"use client";

import * as React from "react";
import type { z } from "zod";
import { ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { summary, validate, type FieldErrors } from "@/lib/validation";

/**
 * Form errors shown the same way everywhere:
 *  - every failing field at once, under the field (pass `errors[key]` to <Field error>) — Field
 *    marks the control aria-invalid (red border, announced by screen readers)
 *  - one toast "กรอกข้อมูลไม่ครบ N ช่อง" and the view scrolls to / focuses the first bad field
 *  - an API 400 { details: { fields } } lands in the same place
 *  - editing a field clears its error (call `clear(key)` from the field's onChange)
 */
export function useFormErrors() {
  const { push } = useToast();
  const [errors, setErrors] = React.useState<FieldErrors>({});

  /** check `data`; sets the errors shown under the fields and returns them ({} = valid) */
  const run = React.useCallback(<S extends z.ZodType>(schema: S, data: unknown): FieldErrors => {
    const v = validate(schema, data);
    const e = v.ok ? {} : v.errors;
    setErrors(e);
    return e;
  }, []);

  const clear = React.useCallback((key: string) => {
    setErrors((e) => {
      if (!(key in e)) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });
  }, []);

  /** toast + focus the first invalid field; false when there is nothing to report */
  const report = React.useCallback(
    (e: FieldErrors) => {
      const msgs = Object.values(e);
      if (!msgs.length) return false;
      push({ kind: "error", title: summary(e), desc: msgs.slice(0, 3).join(" · ") + (msgs.length > 3 ? " …" : "") });
      focusFirstInvalid();
      return true;
    },
    [push]
  );

  /** an API answer with field errors → shown under the fields; false for any other error */
  const fromApi = React.useCallback(
    (err: unknown) => {
      const fields = apiFieldErrors(err);
      if (!fields) return false;
      setErrors(fields);
      report(fields);
      return true;
    },
    [report]
  );

  return { errors, setErrors, run, clear, report, fromApi };
}

export function apiFieldErrors(err: unknown): FieldErrors | null {
  if (!(err instanceof ApiError) || err.status !== 400) return null;
  const f = (err.details as { fields?: unknown } | undefined)?.fields;
  return f && typeof f === "object" && Object.keys(f).length ? (f as FieldErrors) : null;
}

/** after React has painted the errors: bring the first invalid control into view and focus it */
export function focusFirstInvalid() {
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>('main [aria-invalid="true"], [role="dialog"] [aria-invalid="true"]');
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.focus({ preventScroll: true });
  });
}
