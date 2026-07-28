/** Normalize classify template_version; unknown/empty → "standard". */
export function normalizeTemplateVersion(raw: string | null | undefined): string {
  const t = raw?.trim();
  if (!t || t.toLowerCase() === 'unknown') return 'standard';
  return t;
}

/** Parse Indian date strings to ISO YYYY-MM-DD. Returns null if unparseable. */
export function toIsoDate(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const s = raw.trim().replace(/\s+at\s+.*/i, '').trim();

  const dmy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (dmy) {
    let [, d, m, y] = dmy;
    let year = parseInt(y, 10);
    if (year < 100) year += year > 50 ? 1900 : 2000;
    const month = parseInt(m, 10);
    const day = parseInt(d, 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  return null;
}

export function normalizeRegistrationNo(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  return raw.toUpperCase().replace(/[\s\-/]/g, '');
}

export function parseIndianAmount(raw: string | null | undefined): number | null {
  if (!raw?.trim()) return null;
  const cleaned = raw.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

const NIL_RE = /^(na|n\/a|nil|none|-|—|no)$/i;

export function cleanNilString(val: string | null | undefined): string | null {
  if (val == null) return null;
  const t = val.trim();
  if (!t || NIL_RE.test(t)) return null;
  return t;
}

export function maskAadhar(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 4) return 'XXXX';
  return `XXXX-XXXX-${digits.slice(-4)}`;
}

export function getPath(obj: Record<string, unknown>, dotPath: string): unknown {
  const parts = dotPath.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

export function setPath(obj: Record<string, unknown>, dotPath: string, value: unknown): void {
  const parts = dotPath.split('.');
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (cur[p] == null || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}
