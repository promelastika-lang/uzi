// Мелкие помощники: числа, даты, файлы.

export function uid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export const pad = (n, len = 2) => String(n).padStart(len, '0');

/** Принимает «12,5» и «12.5». Пусто или мусор → null. */
export function parseNum(text) {
  if (text === null || text === undefined) return null;
  const t = String(text).trim().replace(',', '.');
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

/** 12.5 → «12,5», до двух знаков. */
export function fmtNum(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '';
  const r = Math.round(v * 100) / 100;
  return String(r).replace('.', ',');
}

export const toDate = (v) => (v instanceof Date ? v : new Date(v));
export const fmtDate = (v) => { const d = toDate(v); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; };
export const fmtTime = (v) => { const d = toDate(v); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const fmtDateTime = (v) => fmtDate(v) + ' ' + fmtTime(v);
export const fileDate = (v = new Date()) => { const d = toDate(v); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

/** Ключ дня в местном времени: 2026-11-13. */
export const dayKey = (v) => fileDate(v);
export function parseDayKey(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function startOfDay(v) { const d = new Date(toDate(v)); d.setHours(0, 0, 0, 0); return d; }
export function addDays(v, n) { const d = new Date(toDate(v)); d.setDate(d.getDate() + n); return d; }
export function addMonths(v, n) { const d = new Date(toDate(v)); const day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + n); const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); d.setDate(Math.min(day, last)); return d; }
export function startOfWeek(v) { const d = startOfDay(v); const wd = (d.getDay() + 6) % 7; return addDays(d, -wd); } // понедельник
export function startOfMonth(v) { const d = startOfDay(v); d.setDate(1); return d; }
export function startOfYear(v) { const d = startOfDay(v); d.setMonth(0, 1); return d; }
export const isSameDay = (a, b) => dayKey(a) === dayKey(b);

/** Значение для <input type="datetime-local">. */
export function toLocalInput(v) {
  const d = toDate(v);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fromLocalInput(s) {
  // Разбираем вручную: старые версии Safari читают такую строку как время по Гринвичу.
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(s || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Сегодня — ближайшие 15 минут, другой день — 09:00. */
export function defaultTime(day) {
  const now = new Date();
  if (isSameDay(day, now)) {
    const d = new Date(now);
    d.setSeconds(0, 0);
    d.setMinutes(d.getMinutes() + ((15 - (d.getMinutes() % 15)) % 15));
    return d;
  }
  const d = startOfDay(day);
  d.setHours(9, 0, 0, 0);
  return d;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** Меню «Поделиться» (на iPhone — Почта, Файлы, AirDrop, Печать) или скачивание. Вызывать прямо из нажатия. */
export async function shareFile(blob, filename, title) {
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
      // не удалось — скачиваем
    }
  }
  downloadBlob(blob, filename);
  return 'downloaded';
}

export function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, 'utf-8');
  });
}

export const isValidEmail = (s) => !s.trim() || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());

export function isValidBirth(d, m, y) {
  d = String(d).trim(); m = String(m).trim(); y = String(y).trim();
  if (!d && !m && !y) return true;
  const day = Number(d), month = Number(m), year = Number(y);
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return false;
  if (year < 1900 || year > new Date().getFullYear()) return false;
  const dt = new Date(year, month - 1, day);
  return dt.getFullYear() === year && dt.getMonth() === month - 1 && dt.getDate() === day;
}
