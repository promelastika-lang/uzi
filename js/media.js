// Фото, видео и аудио: подготовка файлов, QR-код, событие для календаря.
import { data, list, putMedia, getMediaData, removeMedia } from './db.js';
import { DISCLAIMER, patientName, studyShort, studyTitle } from './models.js';
import { uid, fmtDateTime, pad } from './util.js';

export const MAX_VIDEO_MB = 60;
export const MAX_PER_PICK = 10;
const PHOTO_MAX = 1600; // пикселей по длинной стороне
const THUMB_MAX = 220;

// ---------- Чтение файлов ----------

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось прочитать картинку.')); };
    img.src = url;
  });
}

function drawScaled(source, width, height, max) {
  const k = Math.min(1, max / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * k));
  canvas.height = Math.max(1, Math.round(height * k));
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

const canvasBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

/** Длительность и кадр для превью у видео; длительность у аудио. При неудаче — нули. */
function probeMedia(blob, kind) {
  return new Promise((resolve) => {
    const el = document.createElement(kind === 'video' ? 'video' : 'audio');
    const url = URL.createObjectURL(blob);
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      resolve(result);
    };
    const timer = setTimeout(() => finish({ duration: 0, thumb: '' }), 4000);
    el.preload = 'metadata';
    el.muted = true;
    el.playsInline = true;
    el.onerror = () => { clearTimeout(timer); finish({ duration: 0, thumb: '' }); };
    el.onloadedmetadata = () => {
      const duration = Number.isFinite(el.duration) ? Math.round(el.duration * 10) / 10 : 0;
      if (kind !== 'video') { clearTimeout(timer); finish({ duration, thumb: '' }); return; }
      el.onseeked = () => {
        let thumb = '';
        try {
          if (el.videoWidth) thumb = drawScaled(el, el.videoWidth, el.videoHeight, THUMB_MAX).toDataURL('image/jpeg', 0.7);
        } catch (e) { thumb = ''; }
        clearTimeout(timer);
        finish({ duration, thumb });
      };
      try { el.currentTime = Math.min(0.2, duration / 2 || 0); } catch (e) { clearTimeout(timer); finish({ duration, thumb: '' }); }
    };
    el.src = url;
  });
}

/**
 * Подготовить выбранные файлы: фото уменьшаем и сжимаем, для видео и аудио узнаём длительность.
 * Возвращает { items: [{ meta, buffer }], errors: [строки] }.
 */
export async function prepareFiles(fileList) {
  const files = Array.from(fileList || []).slice(0, MAX_PER_PICK);
  const items = [];
  const errors = [];
  for (const file of files) {
    try {
      const type = file.type || '';
      const base = { id: uid(), fileName: file.name || '', caption: '', createdAt: new Date().toISOString(), appointmentId: null, patientId: null };
      if (type.startsWith('image/')) {
        const img = await loadImage(file);
        const canvas = drawScaled(img, img.naturalWidth || img.width, img.naturalHeight || img.height, PHOTO_MAX);
        const blob = await canvasBlob(canvas, 'image/jpeg', 0.85);
        const thumb = drawScaled(img, img.naturalWidth || img.width, img.naturalHeight || img.height, THUMB_MAX).toDataURL('image/jpeg', 0.7);
        const buffer = await blob.arrayBuffer();
        items.push({ meta: { ...base, kind: 'photo', mime: 'image/jpeg', duration: 0, size: buffer.byteLength, thumb }, buffer });
      } else if (type.startsWith('video/')) {
        if (file.size > MAX_VIDEO_MB * 1024 * 1024) {
          errors.push(`${file.name || 'Видео'}: больше ${MAX_VIDEO_MB} МБ. Обрежьте ролик в «Фото» и добавьте снова.`);
          continue;
        }
        const probe = await probeMedia(file, 'video');
        const buffer = await file.arrayBuffer();
        items.push({ meta: { ...base, kind: 'video', mime: type, duration: probe.duration, size: buffer.byteLength, thumb: probe.thumb }, buffer });
      } else if (type.startsWith('audio/')) {
        const probe = await probeMedia(file, 'audio');
        const buffer = await file.arrayBuffer();
        items.push({ meta: { ...base, kind: 'audio', mime: type, duration: probe.duration, size: buffer.byteLength, thumb: '' }, buffer });
      } else {
        errors.push(`${file.name || 'Файл'}: подходят только фото, видео и аудио.`);
      }
    } catch (e) {
      errors.push(`${file.name || 'Файл'}: ${(e && e.message) || e}`);
    }
  }
  return { items, errors };
}

/** Запись с диктофона → элемент медиа. */
export async function audioItem(blob, duration) {
  const buffer = await blob.arrayBuffer();
  const stamp = new Date();
  const name = `audio-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}`;
  const ext = (blob.type || '').includes('mp4') ? 'm4a' : (blob.type || '').includes('webm') ? 'webm' : 'audio';
  return {
    meta: {
      id: uid(), kind: 'audio', mime: blob.type || 'audio/mp4', fileName: name + '.' + ext, caption: '',
      duration: Math.round(duration * 10) / 10, size: buffer.byteLength, thumb: '',
      createdAt: stamp.toISOString(), appointmentId: null, patientId: null,
    },
    buffer,
  };
}

/** Сохранить подготовленные файлы, привязав к записи и пациенту. */
export async function storeItems(items, link) {
  for (const it of items) {
    await putMedia({ ...it.meta, appointmentId: link.appointmentId || null, patientId: link.patientId || null }, it.buffer);
  }
}

// ---------- Выборки ----------

const byDate = (a, b) => String(a.createdAt).localeCompare(String(b.createdAt));
export const mediaOfAppointment = (appointmentId) => list('mediaMeta').filter((m) => m.appointmentId === appointmentId).sort(byDate);
export const mediaOfPatient = (patientId) => list('mediaMeta').filter((m) => m.patientId === patientId).sort(byDate);
export const totalMediaBytes = () => list('mediaMeta').reduce((sum, m) => sum + (m.size || 0), 0);

export async function mediaBlob(meta) {
  const buffer = await getMediaData(meta.id);
  return buffer ? new Blob([buffer], { type: meta.mime || 'application/octet-stream' }) : null;
}

/** Убрать медиа удалённых записей и пациентов. */
export async function removeMediaOf({ appointmentIds = [], patientIds = [] }) {
  const a = new Set(appointmentIds);
  const p = new Set(patientIds);
  const ids = list('mediaMeta').filter((m) => (m.appointmentId && a.has(m.appointmentId)) || (!m.appointmentId && m.patientId && p.has(m.patientId))).map((m) => m.id);
  await removeMedia(ids);
}

/** Медиа, чьей записи и пациента больше нет в базе. */
export function orphanMediaIds() {
  return list('mediaMeta').filter((m) => {
    if (m.appointmentId) return !data.appointments.has(m.appointmentId);
    if (m.patientId) return !data.patients.has(m.patientId);
    return true;
  }).map((m) => m.id);
}

export function fmtSize(bytes) {
  if (!bytes) return '0 КБ';
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' КБ';
  const mb = bytes / (1024 * 1024);
  return (mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10).toString().replace('.', ',') + ' МБ';
}

export function fmtDuration(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

// ---------- Base64 для резервной копии ----------

export function bufferToBase64(buffer, mime) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => { const s = String(reader.result); resolve(s.slice(s.indexOf(',') + 1)); };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([buffer], { type: mime || 'application/octet-stream' }));
  });
}

export async function base64ToBuffer(base64) {
  const response = await fetch('data:application/octet-stream;base64,' + base64);
  return response.arrayBuffer();
}

// ---------- QR-код ----------

let qrLoading = null;
function loadQrLibrary() {
  if (window.qrcode) return Promise.resolve();
  if (!qrLoading) {
    qrLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/qrcode.js';
      s.onload = resolve;
      s.onerror = () => { qrLoading = null; reject(new Error('Не удалось загрузить модуль QR-кода. Проверьте интернет при первом запуске.')); };
      document.head.appendChild(s);
    });
  }
  return qrLoading;
}

const utf8Length = (text) => new TextEncoder().encode(text).length;

/** Текст для QR-кода: кратко о протоколе и заключение. Пациент наводит камеру и читает. */
export function qrText(appt, patient, clinic) {
  const p = patient || {};
  const initials = [p.name, p.middleName].filter(Boolean).map((x) => x.charAt(0).toUpperCase() + '.').join('');
  const head = [
    `Протокол УЗИ № ${appt.protocolNumber || '—'} от ${fmtDateTime(appt.date)}`,
    clinic && clinic.name ? clinic.name : '',
    `Пациент: ${[p.surname, initials].filter(Boolean).join(' ') || '—'}`,
    studyShort(appt) ? `Исследование: ${studyTitle(appt).replace(/^УЗИ: /, '')}` : '',
  ].filter(Boolean);
  const tail = [appt.doctorName ? `Врач: ${appt.doctorName}` : '', DISCLAIMER].filter(Boolean);
  let conclusion = (appt.conclusion || '').trim() || 'не написано';
  const build = () => [...head, `Заключение: ${conclusion}`, ...tail].join('\n');
  // QR вмещает ограниченный объём: длинное заключение обрезаем.
  while (utf8Length(build()) > 1000 && conclusion.length > 40) conclusion = conclusion.slice(0, Math.floor(conclusion.length * 0.9)).trimEnd() + '…';
  return build();
}

/** Матрица QR-кода: { size, dark(row, col) }. */
export async function qrMatrix(text) {
  await loadQrLibrary();
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  const qr = window.qrcode(0, 'M');
  qr.addData(binary, 'Byte');
  qr.make();
  const size = qr.getModuleCount();
  return { size, dark: (r, c) => qr.isDark(r, c) };
}

// ---------- Событие для календаря (.ics) ----------

const icsDate = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
const icsEscape = (text) => String(text || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Строка не длиннее 75 байт: длинные переносим с пробелом в начале продолжения. */
function icsFold(line) {
  const encoder = new TextEncoder();
  const out = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const len = encoder.encode(ch).length;
    if (bytes + len > 73) {
      out.push(current);
      current = ' ' + ch;
      bytes = 1 + len;
    } else {
      current += ch;
      bytes += len;
    }
  }
  out.push(current);
  return out.join('\r\n');
}

/** Файл события: приём с напоминанием за remindMinutes минут. */
export function buildIcs(appt, patient, { remindMinutes = 15, visitMinutes = 30 } = {}) {
  const start = new Date(appt.date);
  const end = new Date(start.getTime() + Math.max(5, visitMinutes) * 60000);
  const p = patient || {};
  const initials = [p.name, p.middleName].filter(Boolean).map((x) => x.charAt(0).toUpperCase() + '.').join('');
  const summary = 'УЗИ: ' + ([p.surname, initials].filter(Boolean).join(' ') || patientName(patient));
  const description = [studyShort(appt), appt.protocolNumber ? 'Протокол № ' + appt.protocolNumber : ''].filter(Boolean).join('\n');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//UZI Protocols//RU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${appt.id}@uzi-protocols`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsEscape(summary)}`,
    description ? `DESCRIPTION:${icsEscape(description)}` : '',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsEscape(summary)}`,
    `TRIGGER:-PT${Math.max(0, Math.round(remindMinutes))}M`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  return lines.map(icsFold).join('\r\n') + '\r\n';
}
