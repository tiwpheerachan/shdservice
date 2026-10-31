'use client';

import * as React from 'react';
import { Keyboard } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cleanCode, typedOnThai } from '@/lib/validation';

/**
 * Thai typed with the keyboard left on Thai that reads as a valid value on the US layout is offered as that value,
 * one tap to take it.
 */
export function CodeInput({
  accepts,
  onFix,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  accepts: (v: string) => boolean;
  onFix: (v: string) => void;
}) {
  // all typed on Thai ("/" "-" = the 2 / 3 keys) first, else with the marks kept — the one the field takes
  const fix =
    [typedOnThai(props.value), typedOnThai(props.value, true)]
      .map((m) => (m == null ? '' : cleanCode(m)))
      .find((f) => f && accepts(f)) ?? '';
  return (
    <>
      <Input {...props} />
      {fix && <TypedOnThai fix={fix} onFix={() => onFix(fix)} />}
    </>
  );
}

export function TypedOnThai({ fix, onFix }: { fix: string; onFix: () => void }) {
  return (
    <p role="status" className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-warning">
      <Keyboard className="h-3.5 w-3.5 shrink-0" />
      <span>
        แป้นพิมพ์เป็นภาษาไทยหรือเปล่า — หมายถึง <span className="num font-semibold">{fix}</span> ใช่ไหม?
      </span>
      <button type="button" onClick={onFix} className="font-medium text-primary underline-offset-4 hover:underline">
        ใช่ แก้ให้
      </button>
    </p>
  );
}
