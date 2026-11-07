// src/phone/moroccanPhone.ts
// Moroccan mobile numbers (06 / 07) as the server accepts them
// (public.normalize_moroccan_mobile). Used to guide the customer before a
// WhatsApp code is requested; the server normalises and checks again.

export function normalizeMoroccanMobile(raw: string | null | undefined): string | null {
  const d = (raw ?? '').replace(/[\s().+-]/g, '');
  let m = /^0([67]\d{8})$/.exec(d);
  if (m) return `+212${m[1]}`;
  m = /^(?:00)?2120?([67]\d{8})$/.exec(d);
  if (m) return `+212${m[1]}`;
  return null;
}

// "+212612345678" -> "06 12 34 56 78"
export function formatMoroccanMobile(e164: string | null | undefined): string {
  const m = /^\+212([67])(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(e164 ?? '');
  return m ? `0${m[1]} ${m[2]} ${m[3]} ${m[4]} ${m[5]}` : (e164 ?? '');
}
