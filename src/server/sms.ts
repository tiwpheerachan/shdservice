import "server-only";

/**
 * Outgoing SMS — one small adapter so the provider is a configuration choice.
 *
 *   SMS_PROVIDER=thaibulksms   ThaiBulkSMS API v2 (needs THAIBULKSMS_API_KEY + THAIBULKSMS_API_SECRET)
 *   SMS_PROVIDER=log           no SMS: the message is printed to the server log (development only)
 *   (unset)                    thaibulksms when both keys are set, otherwise log
 *
 * `log` is refused in production — an OTP in a log file is a key to a customer's data.
 * Never log the message text of a real send (it contains the OTP).
 */
export type SmsProvider = "thaibulksms" | "log";

export function smsProvider(): SmsProvider | null {
  const explicit = (process.env.SMS_PROVIDER ?? "").trim().toLowerCase();
  const hasKeys = !!(process.env.THAIBULKSMS_API_KEY ?? "").trim() && !!(process.env.THAIBULKSMS_API_SECRET ?? "").trim();
  const chosen: SmsProvider = explicit === "thaibulksms" || explicit === "log" ? explicit : hasKeys ? "thaibulksms" : "log";
  if (chosen === "thaibulksms" && !hasKeys) return null;
  if (chosen === "log" && process.env.NODE_ENV === "production") return null;
  return chosen;
}

/** can the app send SMS right now? (the /track page hides the phone option otherwise) */
export const smsAvailable = () => smsProvider() !== null;

/** 0812345678 → the same, for ThaiBulkSMS (it accepts Thai mobile format or E.164) */
export async function sendSms(phone10: string, message: string): Promise<boolean> {
  const provider = smsProvider();
  if (!provider) return false;

  if (provider === "log") {
    // development only (smsProvider() refuses this in production). The OTP is printed HERE and
    // nowhere else — not in the API response, not on the page, not in track_event.
    console.log(`[sms:log] to ${phone10}: ${message}`);
    return true;
  }

  // ThaiBulkSMS API v2 — POST https://api-v2.thaibulksms.com/sms, Basic auth API key : API secret
  const key = process.env.THAIBULKSMS_API_KEY!.trim();
  const secret = process.env.THAIBULKSMS_API_SECRET!.trim();
  const body = new URLSearchParams({ msisdn: phone10, message });
  const sender = (process.env.THAIBULKSMS_SENDER ?? "").trim();
  if (sender) body.set("sender", sender); // approved sender name; default of the account when empty
  const force = (process.env.THAIBULKSMS_FORCE ?? "").trim(); // "standard" | "corporate"
  if (force === "standard" || force === "corporate") body.set("force", force);
  try {
    const r = await fetch("https://api-v2.thaibulksms.com/sms", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const d = (await r.json().catch(() => ({}))) as {
      phone_number_list?: unknown[];
      bad_phone_number_list?: { message?: string }[];
      error?: { code?: number | string; name?: string; description?: string };
    };
    if (!r.ok || d.error || !d.phone_number_list?.length) {
      // e.g. ERROR_USER_TRIAL (trial accounts can only send to their registered number)
      console.error("[sms:thaibulksms] send failed", r.status, d.error?.name ?? "", d.bad_phone_number_list?.[0]?.message ?? "");
      return false;
    }
    return true;
  } catch (e) {
    console.error("[sms:thaibulksms] send failed", e instanceof Error ? e.name : "error");
    return false;
  }
}
