'use client';

import * as React from 'react';
import { OTP_LENGTH, OTP_PATTERN, TRACK_MSG, type PublicJob, type PublicJobSummary } from '@/lib/track-public';
import { useSessionClock } from './session-clock';

export type Step = 'phone' | 'code' | 'list' | 'detail';
export type Tab = 'active' | 'history';

const SESSION_HEADER = 'x-track-session';

/** list filters — applied in the browser to the list the server already scoped to this customer */
export type Filters = { q: string; status: string; from: string; to: string };
export const NO_FILTERS: Filters = { q: '', status: '', from: '', to: '' };

type Reply = { ok?: boolean; error?: string; reason?: string };

/**
 * Every /track call (link and OTP flows). Never throws: no answer (offline → "Failed to fetch") or a body that
 * is not ours (a proxy's error page) comes back as status 0 / `{ error: TRACK_MSG.network }` — Thai, like the rest.
 */
export async function call<T>(path: string, init: RequestInit & { session?: string } = {}) {
  const { session, ...rest } = init;
  try {
    const r = await fetch(path, {
      ...rest,
      headers: {
        'Content-Type': 'application/json',
        ...(session ? { [SESSION_HEADER]: session } : {}),
        ...(rest.headers ?? {}),
      },
      cache: 'no-store',
      credentials: 'same-origin',
      referrerPolicy: 'no-referrer',
    });
    return { status: r.status, d: (await r.json()) as T & Reply };
  } catch {
    return { status: 0, d: { error: TRACK_MSG.network } as T & Reply };
  }
}

const EMPTY_CODE: string[] = Array(OTP_LENGTH).fill('');

/** everything /track's OTP flow keeps; the session token is a ref — memory only, sent as `x-track-session` */
export function useTrackSession(getToken: () => Promise<string | null>) {
  const [step, setStep] = React.useState<Step>('phone');
  const [phone, setPhone] = React.useState('');
  const [code, setCode] = React.useState<string[]>(EMPTY_CODE);
  /** bumped after a wrong code → the boxes clear and the first one takes focus */
  const [codeReset, setCodeReset] = React.useState(0);
  const [masked, setMasked] = React.useState('');
  const [requestId, setRequestId] = React.useState('');
  const [resendAt, setResendAt] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [tab, setTab] = React.useState<Tab>('active');
  const [pages, setPages] = React.useState<Record<Tab, number>>({ active: 1, history: 1 });
  const [filters, setFilters] = React.useState<Filters>(NO_FILTERS);
  const [lists, setLists] = React.useState<{ active: PublicJobSummary[]; history: PublicJobSummary[] }>({
    active: [],
    history: [],
  });
  const [job, setJob] = React.useState<PublicJob | null>(null);
  const [expiresAt, setExpiresAt] = React.useState(0);
  const session = React.useRef<string | null>(null);

  const signOut = React.useCallback((message = '') => {
    const s = session.current;
    session.current = null;
    if (s) void call('/api/track/me', { method: 'DELETE', session: s }).catch(() => {});
    // signed in → out (ออก / expired): the next person on a shared phone must not see this number
    if (s) setPhone('');
    setJob(null);
    setLists({ active: [], history: [] });
    setCode(EMPTY_CODE);
    setRequestId('');
    setExpiresAt(0);
    setError(message);
    setStep('phone');
  }, []);

  /** also the ต่อเวลา button of the last 2 minutes (ExpiryWarning) */
  const extend = () => {
    if (!session.current) return;
    void call<{ expiresAt?: string }>('/api/track/me/keepalive', { method: 'POST', session: session.current }).then(
      ({ status, d }) => {
        if (status === 401) signOut(TRACK_MSG.sessionExpired);
        else if (d.expiresAt) setExpiresAt(Date.parse(d.expiresAt));
      },
    );
  };
  const markActive = useSessionClock(
    expiresAt,
    () => {
      if (session.current) signOut(TRACK_MSG.sessionExpired);
    },
    extend,
  );

  const requestCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      const turnstileToken = await getToken();
      if (!turnstileToken) throw new Error(TRACK_MSG.unavailable);
      const { d } = await call<{ requestId?: string; masked?: string; resendIn?: number }>('/api/track/otp/request', {
        method: 'POST',
        body: JSON.stringify({ phone, turnstileToken }),
      });
      if (!d.ok || !d.requestId) throw new Error(d.error ?? TRACK_MSG.sessionFail);
      setRequestId(d.requestId);
      setMasked(d.masked ?? '');
      setResendAt(Date.now() + (d.resendIn ?? 60) * 1000);
      setCode(EMPTY_CODE);
      setStep('code');
    } catch (err) {
      setError(err instanceof Error ? err.message : TRACK_MSG.sessionFail);
    } finally {
      setBusy(false);
    }
  };

  const loadList = async (token: string) => {
    const { status, d } = await call<{ active?: PublicJobSummary[]; history?: PublicJobSummary[]; expiresAt?: string }>(
      '/api/track/me',
      { session: token },
    );
    if (status === 401 || !d.ok) {
      signOut(d.error ?? TRACK_MSG.sessionExpired);
      return;
    }
    setLists({ active: d.active ?? [], history: d.history ?? [] });
    if (d.expiresAt) setExpiresAt(Date.parse(d.expiresAt));
    setTab((d.active ?? []).length ? 'active' : 'history');
    setPages({ active: 1, history: 1 });
    setFilters(NO_FILTERS);
    setStep('list');
  };

  /** called by the boxes as soon as the last digit is in — no confirm button */
  const verify = async (value: string) => {
    if (busy || !OTP_PATTERN.test(value)) return;
    setBusy(true);
    setError('');
    try {
      const { d } = await call<{ session?: string; expiresAt?: string }>('/api/track/otp/verify', {
        method: 'POST',
        body: JSON.stringify({ requestId, code: value }),
      });
      if (!d.ok || !d.session) throw new Error(d.error ?? TRACK_MSG.otpFail);
      session.current = d.session;
      markActive();
      if (d.expiresAt) setExpiresAt(Date.parse(d.expiresAt));
      await loadList(d.session);
    } catch (err) {
      setError(err instanceof Error ? err.message : TRACK_MSG.otpFail);
      setCode(EMPTY_CODE);
      setCodeReset((n) => n + 1);
    } finally {
      setBusy(false);
    }
  };

  const openJob = async (no: string) => {
    if (!session.current) return;
    setBusy(true);
    setError('');
    try {
      const { status, d } = await call<{ job?: PublicJob; expiresAt?: string }>(
        `/api/track/me/jobs/${encodeURIComponent(no)}`,
        { session: session.current },
      );
      if (status === 401) return signOut(TRACK_MSG.sessionExpired);
      if (!d.ok || !d.job) throw new Error(d.error ?? 'ไม่พบรายการ');
      setJob(d.job);
      if (d.expiresAt) setExpiresAt(Date.parse(d.expiresAt));
      setStep('detail');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ไม่พบรายการ');
    } finally {
      setBusy(false);
    }
  };

  // documents: the session authorises them — the server checks the job is this customer's
  const openDoc = async (d: { kind: string; ref: string }) => {
    const s = session.current;
    if (!s || !job) return {};
    markActive();
    const { status, d: r } = await call<{ url?: string }>('/api/track/doc', {
      method: 'POST',
      session: s,
      body: JSON.stringify({ jobNo: job.no, kind: d.kind, ref: d.ref }),
    });
    if (status === 401) {
      signOut(TRACK_MSG.sessionExpired);
      return {};
    }
    return { url: r.ok ? r.url : undefined, error: r.error };
  };

  return {
    step,
    setStep,
    phone,
    setPhone,
    code,
    setCode,
    codeReset,
    masked,
    resendAt,
    busy,
    error,
    tab,
    setTab,
    pages,
    setPages,
    filters,
    setFilters,
    lists,
    job,
    expiresAt,
    extend,
    signOut,
    requestCode,
    verify,
    openJob,
    openDoc,
  };
}
