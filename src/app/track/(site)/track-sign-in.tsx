'use client';

import * as React from 'react';
import { Loader2, MessageSquareText, Phone, ShieldCheck } from 'lucide-react';
import { OTP_LENGTH } from '@/lib/track-public';
import { useNow } from './session-clock';
import { cn } from '@/lib/utils';

const inputCls =
  'num h-11 w-full rounded-md border border-input bg-background px-3 text-base tracking-wide outline-hidden focus-visible:ring-2 focus-visible:ring-ring';
const btnCls =
  'inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50';

/** step 1: the mobile number → ขอรหัส OTP (the Turnstile token is fetched by onSubmit) */
export function PhoneStep({
  phone,
  setPhone,
  onSubmit,
  busy,
  verifying,
  errorBox,
}: {
  phone: string;
  setPhone: (v: string) => void;
  onSubmit: (e?: React.FormEvent) => void;
  busy: boolean;
  verifying: boolean;
  errorBox: React.ReactNode;
}) {
  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-4">
      <p className="text-sm text-muted-foreground">
        กรอกเบอร์มือถือที่ให้ไว้กับศูนย์บริการ ระบบจะส่งรหัส OTP ทาง SMS เพื่อยืนยันตัวตน
      </p>
      <div>
        <label htmlFor="phone" className="mb-1 block text-xs font-medium">
          เบอร์มือถือ
        </label>
        <div className="relative">
          <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            id="phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/[^\d+\- ]/g, '').slice(0, 16))}
            placeholder="0812345678"
            inputMode="tel"
            autoComplete="tel"
            className={cn(inputCls, 'pl-9')}
          />
        </div>
      </div>
      {errorBox}
      <button type="submit" disabled={busy || verifying || phone.replace(/\D/g, '').length < 9} className={btnCls}>
        {busy || verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquareText className="h-4 w-4" />}
        {verifying ? 'กำลังตรวจสอบความปลอดภัย…' : 'ขอรหัส OTP'}
      </button>
    </form>
  );
}

/** step 2: the SMS code — verified as soon as the last box is filled; เปลี่ยนเบอร์ / ขอรหัสใหม่ */
export function CodeStep({
  masked,
  code,
  setCode,
  codeReset,
  onComplete,
  onChangePhone,
  onResend,
  resendAt,
  busy,
  verifying,
  errorBox,
}: {
  masked: string;
  code: string[];
  setCode: (next: string[]) => void;
  codeReset: number;
  onComplete: (code: string) => void;
  onChangePhone: () => void;
  onResend: () => void;
  resendAt: number;
  busy: boolean;
  verifying: boolean;
  errorBox: React.ReactNode;
}) {
  return (
    <div className="mt-4 space-y-4">
      <p className="text-sm text-muted-foreground">
        ส่งรหัส {OTP_LENGTH} หลักไปที่ <span className="num font-medium text-foreground">{masked}</span> แล้ว
        (ถ้าเบอร์นี้อยู่ในระบบ) · รหัสใช้ได้ 5 นาที
      </p>
      <div>
        <p className="mb-2 text-xs font-medium">รหัส OTP</p>
        <OtpBoxes value={code} onChange={setCode} onComplete={onComplete} disabled={busy} resetKey={codeReset} />
        <p className="mt-2 flex h-5 items-center justify-center gap-1.5 text-xs text-muted-foreground">
          {busy ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> กำลังตรวจสอบรหัส…
            </>
          ) : (
            <>
              <ShieldCheck className="h-3.5 w-3.5" /> กรอกครบ {OTP_LENGTH} หลักแล้วระบบจะยืนยันให้อัตโนมัติ
            </>
          )}
        </p>
      </div>
      {errorBox}
      <div className="flex items-center justify-between text-sm">
        <button
          type="button"
          onClick={onChangePhone}
          className="min-h-11 px-2 text-muted-foreground hover:text-foreground"
        >
          เปลี่ยนเบอร์
        </button>
        <ResendButton resendAt={resendAt} disabled={busy || verifying} onClick={onResend} />
      </div>
    </div>
  );
}

/**
 * OTP_LENGTH one-digit boxes: a digit moves to the next box, Backspace on an empty box goes back,
 * ← / → move, and a pasted or SMS-autofilled code (iOS / Android "one-time-code") spreads
 * over the boxes. The last digit calls onComplete — there is no confirm button.
 */
function OtpBoxes({
  value,
  onChange,
  onComplete,
  disabled,
  resetKey,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  onComplete: (code: string) => void;
  disabled: boolean;
  resetKey: number;
}) {
  const refs = React.useRef<(HTMLInputElement | null)[]>([]);
  const focus = (i: number) => {
    const el = refs.current[Math.max(0, Math.min(OTP_LENGTH - 1, i))];
    el?.focus();
    el?.select();
  };

  // first box on mount and after a wrong code
  React.useEffect(() => {
    focus(0);
  }, [resetKey]);

  /** put `digits` in from box `at` onward; complete → submit */
  const fill = (at: number, digits: string) => {
    const next = [...value];
    for (let k = 0; k < digits.length && at + k < OTP_LENGTH; k++) next[at + k] = digits.charAt(k);
    onChange(next);
    if (next.every((d) => d !== '')) {
      refs.current[Math.min(at + digits.length, OTP_LENGTH) - 1]?.blur();
      onComplete(next.join(''));
    } else {
      focus(at + digits.length);
    }
  };

  return (
    <div className="flex justify-center gap-2" role="group" aria-label={`รหัส OTP ${OTP_LENGTH} หลัก`}>
      {value.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={d}
          disabled={disabled}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`รหัสหลักที่ ${i + 1}`}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, '');
            if (!digits) {
              const next = [...value];
              next[i] = '';
              onChange(next);
              return;
            }
            if (digits.length >= OTP_LENGTH) return fill(0, digits.slice(0, OTP_LENGTH)); // SMS autofill: the whole code
            if (d && digits.length === 2) return fill(i, digits.charAt(0) === d ? digits.charAt(1) : digits.charAt(0)); // typed over an unselected digit
            fill(i, digits); // one typed digit (the old one was selected) or a partial paste
          }}
          onPaste={(e) => {
            const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH);
            if (!digits) return;
            e.preventDefault();
            fill(digits.length === OTP_LENGTH ? 0 : i, digits);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !d && i > 0) {
              e.preventDefault();
              const next = [...value];
              next[i - 1] = '';
              onChange(next);
              focus(i - 1);
            } else if (e.key === 'ArrowLeft') {
              e.preventDefault();
              focus(i - 1);
            } else if (e.key === 'ArrowRight') {
              e.preventDefault();
              focus(i + 1);
            }
          }}
          className={cn(
            'num h-12 w-11 rounded-md border border-input bg-background text-center text-xl font-semibold outline-hidden transition-[border-color,box-shadow]',
            'focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 disabled:opacity-60',
            d && 'border-primary/60',
          )}
        />
      ))}
    </div>
  );
}

/** ขอรหัสใหม่ — its own 1-second clock, so the countdown does not re-render the whole page */
function ResendButton({ resendAt, disabled, onClick }: { resendAt: number; disabled: boolean; onClick: () => void }) {
  const waitMs = resendAt - useNow();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || waitMs > 0}
      className="min-h-11 px-2 font-medium text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
    >
      {waitMs > 0 ? `ขอรหัสใหม่ได้ใน ${Math.ceil(waitMs / 1000)} วินาที` : 'ขอรหัสใหม่'}
    </button>
  );
}
