import "server-only";

/**
 * The SMS behind the /track OTP — one small adapter so the provider is a configuration choice.
 *
 *   SMS_PROVIDER=thaibulksms   ThaiBulkSMS OTP service (needs THAIBULKSMS_OTP_KEY + THAIBULKSMS_OTP_SECRET,
 *                              the key / secret of an app in ThaiBulkSMS → OTP Manager). ThaiBulkSMS
 *                              makes the code, sends the SMS (the app's template) and checks the code.
 *   SMS_PROVIDER=log           no SMS: our own code is printed to the server log (development only)
 *   (unset)                    thaibulksms when both keys are set, otherwise log
 *
 * `log` is refused in production — an OTP in a log file is a key to a customer's data.
 * Never log a code, a token or the keys.
 */
export type SmsProvider = "thaibulksms" | "log";

const OTP_API = "https://otp.thaibulksms.com/v2/otp";

function keys() {
  return { key: (process.env.THAIBULKSMS_OTP_KEY ?? "").trim(), secret: (process.env.THAIBULKSMS_OTP_SECRET ?? "").trim() };
}

export function smsProvider(): SmsProvider | null {
  const explicit = (process.env.SMS_PROVIDER ?? "").trim().toLowerCase();
  const k = keys();
  const hasKeys = !!k.key && !!k.secret;
  const chosen: SmsProvider = explicit === "thaibulksms" || explicit === "log" ? explicit : hasKeys ? "thaibulksms" : "log";
  if (chosen === "thaibulksms" && !hasKeys) return null;
  if (chosen === "log" && process.env.NODE_ENV === "production") return null;
  return chosen;
}

/** can the app send an OTP right now? (the /track page hides the phone option otherwise) */
export const smsAvailable = () => smsProvider() !== null;

/** development `log` mode: the code is printed HERE and nowhere else — not in the API response, not on the page, not in track_event */
export function printDevOtp(phone10: string, code: string) {
  console.log(`[sms:log] to ${phone10}: รหัส OTP ของคุณคือ ${code} (ใช้ได้ 5 นาที) สำหรับติดตามสถานะงานซ่อม SHD — ห้ามบอกรหัสนี้กับผู้อื่น`);
}

type OtpAnswer = { status?: string; token?: string; errors?: { message?: string; detail?: unknown }[] };

async function post(path: "request" | "verify", fields: Record<string, string>) {
  const r = await fetch(`${OTP_API}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ ...keys(), ...fields }),
    signal: AbortSignal.timeout(10_000),
  });
  return { status: r.status, d: (await r.json().catch(() => ({}))) as OtpAnswer };
}

/** why ThaiBulkSMS said no — its error name / message only (never the code, token or keys) */
const why = (d: OtpAnswer) => {
  const e = d.errors?.[0];
  return [typeof e?.detail === "string" ? e.detail : "", e?.message ?? ""].filter(Boolean).join(" ");
};

/** ThaiBulkSMS sends a code to this number → its token for the request; null = not sent */
export async function requestOtpSms(phone10: string): Promise<string | null> {
  try {
    const { status, d } = await post("request", { msisdn: phone10 });
    if (status === 200 && d.status === "success" && typeof d.token === "string" && d.token && d.token.length <= 128) return d.token;
    console.error("[sms:thaibulksms] otp request failed", status, why(d));
    return null;
  } catch (e) {
    console.error("[sms:thaibulksms] otp request failed", e instanceof Error ? e.name : "error");
    return null;
  }
}

/** does ThaiBulkSMS accept this code for its token? "error" = it could not answer (keys, network…) */
export async function checkOtpSms(token: string, code: string): Promise<"ok" | "wrong" | "error"> {
  try {
    const { status, d } = await post("verify", { token, pin: code });
    if (status === 200 && d.status === "success") return "ok";
    if (status === 400) {
      // a wrong / expired code is an everyday answer; anything else (app not found, bad key…) is a setup problem
      if (!/^code is /i.test(d.errors?.[0]?.message ?? "")) console.error("[sms:thaibulksms] otp verify refused", status, why(d));
      return "wrong";
    }
    console.error("[sms:thaibulksms] otp verify failed", status, why(d));
    return "error";
  } catch (e) {
    console.error("[sms:thaibulksms] otp verify failed", e instanceof Error ? e.name : "error");
    return "error";
  }
}
