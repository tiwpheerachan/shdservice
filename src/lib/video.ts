import type { InputVideoTrack } from 'mediabunny';
import { ApiError, api, postJson, xhrSend } from '@/lib/api';

/**
 * Video job attachments (a customer's clip of the fault), made ready in the browser BEFORE anything is uploaded,
 * with mediabunny (WebCodecs) — imported only once a video is picked: ≤ 3 minutes; re-encoded to MP4 H.264 + AAC
 * inside 1920×1080, ≤ 30 fps, at a constant quality (as small as 1080p allows — a 3-minute clip of a
 * device on a desk is ~35–60 MB, never over ~115 MB), so it plays in every browser; plus a small JPEG of
 * the frame ~1 s in (the list's thumbnail). A browser that cannot convert it (no WebCodecs, no H.264 / AAC
 * encoder, a codec it cannot decode) sends the original if it is within the cap — it may not play everywhere.
 * uploadVideo then PUTs it straight to storage (src/app/api/attachments/video) — never through our server.
 */
export const VIDEO_MAX_SECONDS = 180;
/** src/server/storage.ts MAX_VIDEO_BYTES */
export const VIDEO_MAX_BYTES = 200 * 1024 * 1024;
export const MAY_NOT_PLAY = 'อาจเล่นไม่ได้ทุกเบราว์เซอร์';
/**
 * Constant quality where the encoder offers it (quantizer, like ffmpeg's CRF; H.264 0–51, lower = better), else a
 * variable ~2.5 Mbps. A clip that comes out heavier than CAP_BYTES (a lot of motion) is encoded once more at a variable
 * 5 Mbps — so 3 minutes stay ≤ ~115 MB.
 */
const QUALITY = { quantizer: 26, bitrate: 2_500_000, bitrateMode: 'variable' } as const;
const CAP_BYTES = 120 * 1024 * 1024;
const CAP_QUALITY = { bitrate: 5_000_000, bitrateMode: 'variable' } as const;
const AUDIO_BITRATE = 96_000; // enough to hear a fan or a rattle
const KEY_FRAME_S = 2; // seeking anywhere starts at once
const MAX_FPS = 30; // a phone's 60 fps nearly doubles the size and shows a fault no better

const TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
};
/** the type the server takes, by the file's name (browsers often leave a .mov's type empty) */
const typeOf = (f: File) => TYPES[f.name.split('.').pop()?.toLowerCase() ?? ''] ?? '';
export const isVideo = (f: File) => !!typeOf(f) || f.type.startsWith('video/');
/** a stored attachment that is a video (its system file name) */
export const isVideoFile = (name = '') => /\.(?:mp4|mov|webm)$/i.test(name);

/** m:ss of a length, whole seconds rounded up (180.3 s is 3:01 — over 3 minutes, never "3:00") */
export const mmss = (seconds: number) => {
  const s = Math.ceil(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export type PreparedVideo = { file: File; thumb: Blob | null; converted: boolean };

/** Checks the length, then converts (`onProgress` 0–100); `signal` cancels. Throws a Thai message when refused. */
export async function prepareVideo(
  src: File,
  onProgress: (pct: number) => void,
  signal: AbortSignal,
): Promise<PreparedVideo> {
  // a file the browser cannot read (an iCloud / OneDrive file not downloaded yet, moved or changed since it was picked)
  await src
    .slice(0, 16)
    .arrayBuffer()
    .catch(() => {
      throw new Error(
        'อ่านไฟล์วิดีโอนี้ไม่ได้ — ถ้าไฟล์อยู่บน iCloud หรือคลาวด์ ให้ดาวน์โหลดลงเครื่องก่อน แล้วเลือกใหม่',
      );
    });
  const mb = await import('mediabunny');
  const input = new mb.Input({ source: new mb.BlobSource(src), formats: mb.ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack().catch(() => null);
    if (!track) throw new Error('เปิดไฟล์วิดีโอนี้ไม่ได้ — รองรับ MP4, MOV, WebM');
    const seconds = await input.computeDuration();
    if (seconds > VIDEO_MAX_SECONDS)
      throw new Error(`วิดีโอยาว ${mmss(seconds)} นาที — แนบได้ไม่เกิน 3 นาที ตัดให้สั้นลงก่อนแนบ`);
    const thumb = await thumbnail(mb, track, seconds).catch(() => null);
    signal.throwIfAborted();

    // inside 1920×1080 (portrait: 1080×1920), never enlarged; H.264 wants even sizes
    const w = await track.getDisplayWidth();
    const h = await track.getDisplayHeight();
    const scale = Math.min(1, 1920 / Math.max(w, h), 1080 / Math.min(w, h));
    const even = (n: number) => Math.max(2, Math.round((n * scale) / 2) * 2);
    const size = { width: even(w), height: even(h) };
    // a 60 fps clip is brought to 30; anything at or under keeps its own rate (no duplicated frames)
    const fps = (await track.computePacketStats(60).catch(() => null))?.averagePacketRate ?? 0;
    const frameRate = fps > MAX_FPS + 1 ? MAX_FPS : undefined;
    if (typeof VideoEncoder === 'undefined' || !(await mb.canEncodeVideo('avc', { ...size, bitrate: QUALITY.bitrate })))
      return original(src, thumb);

    /** one conversion at `quality`; null = a track it cannot convert (the sound of a noise fault is the point) */
    const convert = async (quality: ConstructorParameters<typeof mb.Quality>[0]) => {
      const output = new mb.Output({
        format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), // plays before it has all loaded
        target: new mb.BufferTarget(),
      });
      const conversion = await mb.Conversion.init({
        input,
        output,
        tracks: 'primary',
        showWarnings: false,
        // always re-encoded: a copied stream would keep the camera's bitrate (and size)
        video: {
          codec: 'avc',
          ...size,
          fit: 'fill',
          frameRate,
          quality: new mb.Quality(quality),
          keyFrameInterval: KEY_FRAME_S,
          forceTranscode: true,
        },
        audio: { codec: 'aac', quality: new mb.Quality({ bitrate: AUDIO_BITRATE }) },
      });
      if (!conversion.isValid || conversion.discardedTracks.length) return null;
      conversion.onProgress = (p) => onProgress(Math.floor(p * 100));
      const cancel = () => void conversion.cancel();
      signal.addEventListener('abort', cancel);
      try {
        await conversion.execute();
      } finally {
        signal.removeEventListener('abort', cancel);
      }
      return output.target.buffer!;
    };
    let mp4 = await convert(QUALITY);
    if (!mp4) return original(src, thumb);
    if (mp4.byteLength > CAP_BYTES) mp4 = (await convert(CAP_QUALITY)) ?? mp4;
    const name = src.name.replace(/\.[^.]*$/, '') + '.mp4';
    return { file: new File([mp4], name, { type: 'video/mp4' }), thumb, converted: true };
  } finally {
    input.dispose();
  }
}

function original(src: File, thumb: Blob | null): PreparedVideo {
  const type = typeOf(src);
  if (!type) throw new Error('เบราว์เซอร์นี้แปลงวิดีโอนี้ไม่ได้ — แนบได้เฉพาะ MP4, MOV, WebM');
  if (src.size > VIDEO_MAX_BYTES)
    throw new Error('เบราว์เซอร์นี้แปลงวิดีโอไม่ได้ และไฟล์ใหญ่เกิน 200MB — ใช้ Chrome, Edge หรือ Safari รุ่นล่าสุด');
  return { file: new File([src], src.name, { type }), thumb, converted: false };
}

/** the frame ~1 s in, 320 px on its long edge — null when this browser cannot decode the clip */
async function thumbnail(mb: typeof import('mediabunny'), track: InputVideoTrack, seconds: number) {
  if (!(await track.canDecode())) return null;
  const landscape = (await track.getDisplayWidth()) >= (await track.getDisplayHeight());
  const sink = new mb.CanvasSink(track, landscape ? { width: 320 } : { height: 320 });
  const canvas = (await sink.getCanvas(Math.min(1, seconds / 2)))?.canvas as HTMLCanvasElement | undefined;
  return canvas ? new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.75)) : null;
}

/**
 * A one-time URL from the server → PUT straight to storage (`onProgress` 0–100; `signal` cancels) → the server
 * checks what arrived and attaches it. An original that was not converted is labelled in its remark.
 */
export async function uploadVideo(
  jobNo: string,
  v: PreparedVideo,
  remark: string,
  onProgress: (pct: number) => void,
  signal: AbortSignal,
) {
  const { file, url } = await postJson<{ file: string; url: string }>('/api/attachments/video', {
    jobNo,
    type: v.file.type,
    size: v.file.size, // signed into the URL: R2 takes these bytes only
  });
  const res = await xhrSend((sent, total) => onProgress(total ? Math.floor((sent / total) * 100) : 0))(url, {
    method: 'PUT',
    body: v.file,
    // signed into the URL (src/server/storage.ts signedUploadUrl): this type only, never over an existing object
    headers: { 'Content-Type': v.file.type, 'If-None-Match': '*' },
    signal,
  }).catch((e: unknown) => {
    // storage not reached while this device is online (R2 down, blocked by a network) is not "check your internet"
    if (signal.aborted || !(e instanceof TypeError) || navigator.onLine === false) throw e;
    throw new Error('อัปโหลดวิดีโอไปที่เก็บไม่สำเร็จ — ลองใหม่อีกครั้ง หากยังไม่ได้ แจ้งผู้ดูแลระบบ');
  });
  if (!res.ok) throw new ApiError(res.status, `อัปโหลดวิดีโอไม่สำเร็จ (ที่เก็บไฟล์ตอบ ${res.status})`);
  const body = new FormData();
  body.set('jobNo', jobNo);
  body.set('file', file);
  body.set('name', v.file.name);
  body.set('remark', v.converted ? remark : [MAY_NOT_PLAY, remark].filter(Boolean).join(' · '));
  if (v.thumb) body.set('thumb', new File([v.thumb], 'thumb.jpg', { type: 'image/jpeg' }));
  return api<{ ok: true; row: { id: string; name: string; file: string; remark: string } }>(
    '/api/attachments/video/confirm',
    { method: 'POST', body },
  );
}
