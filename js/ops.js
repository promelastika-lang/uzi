// Операции с записями и пациентами.
import { data, list, put, remove, getSettings, setSettings } from './db.js';
import { normalizeBlocks } from './models.js';
import { uid, pad, toDate, dayKey } from './util.js';

export const appointmentsSorted = () => list('appointments').sort((a, b) => new Date(a.date) - new Date(b.date));

/** Записи по дням: Map «2026-11-13» → [записи по времени]. */
export function appointmentsByDay() {
  const map = new Map();
  for (const a of appointmentsSorted()) {
    const k = dayKey(a.date);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(a);
  }
  return map;
}

export const patientOf = (appt) => (appt && appt.patientId ? data.patients.get(appt.patientId) || null : null);

/** Номер протокола вида ГГГГММДД-NNNN (нумерация в пределах дня). */
export function generateProtocolNumber(date, excludeId) {
  const d = toDate(date);
  const prefix = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-`;
  let max = 0;
  for (const a of data.appointments.values()) {
    if (a.id === excludeId) continue;
    const n = String(a.protocolNumber || '');
    if (n.startsWith(prefix)) {
      const v = parseInt(n.slice(prefix.length), 10);
      if (Number.isFinite(v) && v > max) max = v;
    }
  }
  return prefix + pad(max + 1, 4);
}

/** Пустой черновик новой записи. */
export function newDraft(date) {
  const s = getSettings();
  return {
    id: null,
    patientId: null,
    surname: '', name: '', middleName: '', gender: 'Ж',
    birthDay: '', birthMonth: '', birthYear: '',
    cardNumber: '', email: '',
    protocolNumber: generateProtocolNumber(date),
    date: toDate(date).toISOString(),
    usSystemName: s.usSystemName || '',
    probeType: s.probeType || '',
    blocks: normalizeBlocks([]),
    significantInfo: '', additionalInfo: '', complications: '', conclusion: '',
    doctorName: s.doctorName || '',
  };
}

export function fillPatient(draft, p) {
  return {
    ...draft,
    patientId: p.id,
    surname: p.surname || '', name: p.name || '', middleName: p.middleName || '',
    gender: p.gender || 'Ж',
    birthDay: p.birthDay ? String(p.birthDay) : '',
    birthMonth: p.birthMonth ? String(p.birthMonth) : '',
    birthYear: p.birthYear ? String(p.birthYear) : '',
    cardNumber: p.cardNumber || '',
  };
}

export function draftFromAppointment(a) {
  const p = patientOf(a);
  const base = {
    id: a.id,
    patientId: a.patientId || null,
    surname: '', name: '', middleName: '', gender: 'Ж',
    birthDay: '', birthMonth: '', birthYear: '', cardNumber: '',
    email: a.email || '',
    protocolNumber: a.protocolNumber || '',
    date: a.date,
    usSystemName: a.usSystemName || '',
    probeType: a.probeType || '',
    blocks: normalizeBlocks(a.blocks),
    significantInfo: a.significantInfo || '',
    additionalInfo: a.additionalInfo || '',
    complications: a.complications || '',
    conclusion: a.conclusion || '',
    doctorName: a.doctorName || '',
  };
  return p ? { ...fillPatient(base, p), email: base.email } : base;
}

/** Последний email пациента из его записей. */
export function lastEmail(patientId) {
  const items = list('appointments').filter((a) => a.patientId === patientId && a.email)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  return items.length ? items[0].email : '';
}

const norm = (s) => String(s || '').trim();

/** Сохранить запись. Тот же пациент (ФИО + дата рождения) переиспользуется. Возвращает id записи. */
export async function saveDraft(draft) {
  const surname = norm(draft.surname), name = norm(draft.name), middleName = norm(draft.middleName);
  const birthDay = parseInt(draft.birthDay, 10) || 0;
  const birthMonth = parseInt(draft.birthMonth, 10) || 0;
  const birthYear = parseInt(draft.birthYear, 10) || 0;

  let patient = draft.patientId ? data.patients.get(draft.patientId) : null;
  if (!patient) {
    const same = (a, b) => a.toLowerCase() === b.toLowerCase();
    patient = list('patients').find((p) => same(norm(p.surname), surname) && same(norm(p.name), name)
      && same(norm(p.middleName), middleName)
      && (p.birthDay || 0) === birthDay && (p.birthMonth || 0) === birthMonth && (p.birthYear || 0) === birthYear) || null;
  }
  const patientRecord = {
    id: patient ? patient.id : uid(),
    surname, name, middleName,
    gender: draft.gender || 'Ж',
    birthDay, birthMonth, birthYear,
    cardNumber: norm(draft.cardNumber),
  };
  await put('patients', patientRecord);

  const previous = draft.id ? data.appointments.get(draft.id) : null;
  const record = {
    id: draft.id || uid(),
    date: toDate(draft.date).toISOString(),
    patientId: patientRecord.id,
    protocolNumber: norm(draft.protocolNumber),
    usSystemName: norm(draft.usSystemName),
    probeType: norm(draft.probeType),
    significantInfo: norm(draft.significantInfo),
    additionalInfo: norm(draft.additionalInfo),
    complications: norm(draft.complications),
    conclusion: norm(draft.conclusion),
    doctorName: norm(draft.doctorName),
    email: norm(draft.email),
    blocks: normalizeBlocks(draft.blocks),
    createdAt: previous ? previous.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await put('appointments', record);

  // Если у записи сменился пациент — прежнего без записей убираем.
  if (previous && previous.patientId && previous.patientId !== patientRecord.id) {
    await removeOrphanPatient(previous.patientId);
  }

  // Запоминаем врача и аппарат для следующих записей.
  const patch = {};
  if (record.doctorName) patch.doctorName = record.doctorName;
  if (record.usSystemName) patch.usSystemName = record.usSystemName;
  if (record.probeType) patch.probeType = record.probeType;
  if (Object.keys(patch).length) setSettings(patch);

  return record.id;
}

async function removeOrphanPatient(patientId) {
  const stillUsed = list('appointments').some((a) => a.patientId === patientId);
  if (!stillUsed && data.patients.has(patientId)) await remove('patients', patientId);
}

/** Удалить запись; пациента без других записей — тоже. */
export async function deleteAppointment(id) {
  const a = data.appointments.get(id);
  if (!a) return;
  await remove('appointments', id);
  if (a.patientId) await removeOrphanPatient(a.patientId);
}
