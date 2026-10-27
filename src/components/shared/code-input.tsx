'use client';

import * as React from 'react';
import { Keyboard } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cleanCode, typedOnThai } from '@/lib/validation';

/**
 * An input for a number with a fixed shape (Serial, Sale Order, IMEI, parcel, document no.): Thai typed into it
 * that reads as a well-formed value on the US keyboard (the keyboard was left on Thai — prod 2026-10: 140
 * serials) is offered as that value, one tap to take it.
 */
export function CodeInput({
  accepts,
  onFix,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  /** is this a well-formed value for the field */
  accepts: (v: string) => boolean;
  /** take the suggested value */
  onFix: (v: string) => void;
}) {
  const meant = typedOnThai(props.value);
  const fix = meant == null ? '' : cleanCode(meant);
  return (
    <>
      <Input {...props} />
      {fix && accepts(fix) && <TypedOnThai fix={fix} onFix={() => onFix(fix)} />}
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
