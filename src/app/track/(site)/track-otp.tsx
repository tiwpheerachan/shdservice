'use client';

import { ArrowLeft, LogOut, Timer } from 'lucide-react';
import { TRACK_MSG } from '@/lib/track-public';
import { focusOnMount, PublicJobView } from './public-job-view';
import { Countdown, ExpiryWarning } from './session-clock';
import { useTrackSession } from './use-track-session';
import { CodeStep, PhoneStep } from './track-sign-in';
import { JobList } from './track-job-list';
import { cn } from '@/lib/utils';

/**
 * /track after the Cloudflare gate: phone → SMS OTP → this customer's jobs.
 *
 * The session token lives ONLY in this component's memory (a ref) and travels in the
 * `x-track-session` header — refresh / close / come back later = a new OTP. The session
 * starts at 15 minutes; while the customer is actually using the page the keepalive keeps
 * at least 5 minutes on the clock, up to 60 minutes from sign-in (server-enforced).
 */
export function TrackOtp({
  getToken,
  verifying,
  devOtpLog,
}: {
  /** a fresh single-use Turnstile token (the gate's, or a background one) — null when unavailable */
  getToken: () => Promise<string | null>;
  /** a background captcha check is running */
  verifying: boolean;
  /** development: the OTP goes to the server log instead of an SMS */
  devOtpLog: boolean;
}) {
  const s = useTrackSession(getToken);
  const { step, error, busy, signOut } = s;

  /* ---------- views ---------- */
  const errorBox = error && (
    <p
      role="alert"
      className={cn(
        'rounded-md px-3 py-2 text-sm',
        error === TRACK_MSG.signedOut ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger',
      )}
    >
      {error}
    </p>
  );

  if (step === 'phone' || step === 'code') {
    return (
      <div className="surface mx-auto max-w-md p-6">
        {/* focus lands here after ออก / an expired session (the list it was on is gone) */}
        <h1 ref={focusOnMount} tabIndex={-1} className="text-lg font-semibold tracking-tight outline-hidden">
          ติดตามสถานะงานซ่อม
        </h1>
        {step === 'phone' ? (
          <PhoneStep
            phone={s.phone}
            setPhone={s.setPhone}
            onSubmit={s.requestCode}
            busy={busy}
            verifying={verifying}
            errorBox={errorBox}
          />
        ) : (
          <CodeStep
            masked={s.masked}
            code={s.code}
            setCode={s.setCode}
            codeReset={s.codeReset}
            onComplete={(v) => void s.verify(v)}
            onChangePhone={() => signOut()}
            onResend={() => void s.requestCode()}
            resendAt={s.resendAt}
            busy={busy}
            verifying={verifying}
            errorBox={errorBox}
          />
        )}
        {devOtpLog && (
          <p className="mt-4 rounded-md border border-dashed border-warning/50 px-3 py-2 text-2xs text-warning">
            โหมดทดสอบ: ยังไม่ส่ง SMS จริง — รหัส OTP แสดงใน log ของ server ([sms:log])
          </p>
        )}
      </div>
    );
  }

  const header = (
    <>
      <SessionHeader expiresAt={s.expiresAt} onSignOut={() => signOut(TRACK_MSG.signedOut)} />
      <ExpiryWarning to={s.expiresAt} onExtend={s.extend} />
    </>
  );

  if (step === 'detail' && s.job) {
    return (
      <div className="space-y-3">
        {header}
        <button
          type="button"
          onClick={() => s.setStep('list')}
          className="inline-flex min-h-11 items-center gap-1.5 px-1 text-sm font-medium text-primary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> กลับไปรายการงาน
        </button>
        <PublicJobView j={s.job} onOpenDoc={s.openDoc} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {header}
      <JobList
        tab={s.tab}
        setTab={s.setTab}
        pages={s.pages}
        setPages={s.setPages}
        filters={s.filters}
        setFilters={s.setFilters}
        lists={s.lists}
        busy={busy}
        onOpen={(no) => void s.openJob(no)}
      />
      {errorBox}
    </div>
  );
}

/** time left (ticks on its own) + ออก */
function SessionHeader({ expiresAt, onSignOut }: { expiresAt: number; onSignOut: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <Timer className="h-3.5 w-3.5" /> เหลือเวลา <Countdown to={expiresAt} />
        <span className="hidden sm:inline">· ต่อเวลาอัตโนมัติเมื่อใช้งานอยู่</span>
      </span>
      <button
        type="button"
        onClick={onSignOut}
        className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 px-2 hover:text-foreground"
      >
        <LogOut className="h-3.5 w-3.5" /> ออก
      </button>
    </div>
  );
}
