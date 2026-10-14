"use client";

/**
 * The root layout itself failed. Replaces the whole document, so no app styles or
 * fonts here — plain inline styles that follow the OS color scheme.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="th">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", fontFamily: "system-ui, sans-serif", colorScheme: "light dark" }}>
        <title>ระบบขัดข้อง</title>
        <div style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 18, margin: 0 }}>ระบบขัดข้องชั่วคราว</h1>
          <p style={{ fontSize: 14, opacity: 0.7 }}>ลองใหม่อีกครั้ง ถ้ายังไม่ได้ แจ้งผู้ดูแลพร้อมรหัสอ้างอิง</p>
          {error.digest && <p style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.7 }}>รหัสอ้างอิง {error.digest}</p>}
          <button type="button" onClick={() => retry()} style={{ marginTop: 12, padding: "8px 16px", fontSize: 14, cursor: "pointer" }}>
            ลองใหม่
          </button>
        </div>
      </body>
    </html>
  );
}
