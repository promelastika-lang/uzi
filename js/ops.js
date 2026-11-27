// Операции с записями и пациентами: сохранение, корзина, журнал изменений, шаблоны приёма, прошлые исследования.
import { data, list, put, putMany, remove, removeMany, getSettings, setSettings } from './db.js';
import { SYSTEMS, normalizeBlocks, hasContent, splitProbes, joinProbes, systemById, patientName } from './models.js';
import { uid, pad, toDate, dayKey } from './util.js';
import { removeMediaOf } from './media.js';

// ---------- Выборки (без корзины) ----------

export const isLive = (a) => !a.deletedAt;
export const liveAppointments = () => list('appointments').filter(isLive);
export const trashedAppointments = () => list('appointments').filter((a) => a.deletedAt)
  .sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
export const appointmentsSorted = () => liveAppointments().sort((a, b) => new Date(a.date) - new Date(b.date));

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

/** Исследования пациента, свежие сверху. */
export function patientStudies(patientId, excludeId) {
  return liveAppointments()
    .filter((a) => a.patientId === patientId && a.id !== excludeId)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

/** Пациенты, у которых есть хотя бы одна запись вне корзины. */
export function livePatients() {
  const used = new Set(liveAppointments().map((a) => a.patientId));
  return list('patients').filter((p) => used.has(p.id));
}

/** Недавние пациенты по дате последней записи. */
export function recentPatients(limit = 5) {
  const last = new Map();
  for (const a of liveAppointments()) {
    const t = new Date(a.date).getTime();
    if (a.patientId && (!last.has(a.patientId) || last.get(a.patientId) < t)) last.set(a.patientId, t);
  }
  return Array.from(last.entries()).sort((x, y) => y[1] - x[1]).slice(0, limit)
    .map(([id]) => data.patients.get(id)).filter(Boolean);
}

/** Автопоиск по номеру карты: от 2 символов, до 3 совпадений. */
export function matchByCard(query) {
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 2) return [];
  return livePatients().filter((p) => String(p.cardNumber || '').toLowerCase().includes(q)).slice(0, 3);
}

// ---------- Номер протокола ----------

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

// ---------- Черновик формы ----------

const EMPTY_PATIENT = {
  patientId: null,
  surname: '', name: '', middleName: '', gender: 'Ж',
  birthDay: '', birthMonth: '', birthYear: '',
  cardNumber: '', height: '', weight: '',
};

/** Пустой черновик новой записи. */
export function newDraft(date) {
  const s = getSettings();
  return {
    id: null,
    ...EMPTY_PATIENT,
    email: '',
    protocolNumber: generateProtocolNumber(date),
    date: toDate(date).toISOString(),
    usSystemName: s.usSystemName || '',
    probes: [],
    blocks: normalizeBlocks([]),
    significantInfo: '', additionalInfo: '', complications: '', conclusion: '',
    doctorName: s.doctorName || '',
  };
}

const str = (v) => (v === null || v === undefined || v === 0 ? '' : String(v));

export function fillPatient(draft, p) {
  return {
    ...draft,
    patientId: p.id,
    surname: p.surname || '', name: p.name || '', middleName: p.middleName || '',
    gender: p.gender || 'Ж',
    birthDay: str(p.birthDay), birthMonth: str(p.birthMonth), birthYear: str(p.birthYear),
    cardNumber: p.cardNumber || '',
    height: str(p.height), weight: str(p.weight),
  };
}

export const detachPatient = (draft) => ({ ...draft, patientId: null });

export function draftFromAppointment(a) {
  const p = patientOf(a);
  const base = {
    id: a.id,
    ...EMPTY_PATIENT,
    email: a.email || '',
    protocolNumber: a.protocolNumber || '',
    date: a.date,
    usSystemName: a.usSystemName || '',
    probes: splitProbes(a.probeType),
    blocks: normalizeBlocks(a.blocks),
    significantInfo: a.significantInfo || '',
    additionalInfo: a.additionalInfo || '',
    complications: a.complications || '',
    conclusion: a.conclusion || '',
    doctorName: a.doctorName || '',
  };
  return p ? fillPatient(base, p) : base;
}

/** Последний email пациента из его записей. */
export function lastEmail(patientId) {
  const items = patientStudies(patientId).filter((a) => a.email);
  return items.length ? items[0].email : '';
}

const norm = (s) => String(s || '').trim();
const same = (a, b) => norm(a).toLowerCase() === norm(b).toLowerCase();

/** Пациент с теми же ФИО и датой рождения (для диалога о дубликате). */
export function findDuplicatePatient(draft) {
  const d = parseInt(draft.birthDay, 10) || 0;
  const m = parseInt(draft.birthMonth, 10) || 0;
  const y = parseInt(draft.birthYear, 10) || 0;
  if (!norm(draft.surname)) return null;
  return list('patients').find((p) => p.id !== draft.patientId
    && same(p.surname, draft.surname) && same(p.name, draft.name) && same(p.middleName, draft.middleName)
    && (p.birthDay || 0) === d && (p.birthMonth || 0) === m && (p.birthYear || 0) === y) || null;
}

// ---------- Журнал изменений ----------

const AUDIT_FIELDS = [
  ['date', 'Дата и время'],
  ['protocolNumber', 'Номер протокола'],
  ['usSystemName', 'УЗ-система'],
  ['probeType', 'Датчики'],
  ['significantInfo', 'Значимая информация'],
  ['additionalInfo', 'Дополнительная информация'],
  ['complications', 'Осложнения'],
  ['conclusion', 'Заключение'],
  ['doctorName', 'ФИО врача'],
  ['email', 'Email'],
];

function describeChanges(before, after, patientBefore, patientAfter) {
  const out = [];
  for (const [key, label] of AUDIT_FIELDS) {
    if (norm(before[key]) !== norm(after[key])) out.push(label);
  }
  const oldBlocks = normalizeBlocks(before.blocks);
  const newBlocks = normalizeBlocks(after.blocks);
  for (const s of SYSTEMS) {
    const a = oldBlocks.find((b) => b.system === s.id);
    const b = newBlocks.find((x) => x.system === s.id);
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push('Измерения: ' + s.title);
  }
  if (patientBefore && patientAfter) {
    const sig = (p) => JSON.stringify([norm(p.surname), norm(p.name), norm(p.middleName), p.gender || '', p.birthDay || 0,
      p.birthMonth || 0, p.birthYear || 0, norm(p.cardNumber), p.height || null, p.weight || null]);
    if (patientBefore.id !== patientAfter.id) out.push('Пациент заменён');
    else if (sig(patientBefore) !== sig(patientAfter)) out.push('Данные пациента');
  }
  return out;
}

// ---------- Сохранение ----------

/**
 * Сохранить запись. options.patientId — использовать этого пациента (ответ на диалог о дубликате).
 * Возвращает id записи.
 */
export async function saveDraft(draft, options = {}) {
  const linkedId = options.patientId || draft.patientId;
  const existingPatient = linkedId ? data.patients.get(linkedId) : null;
  const patientBefore = existingPatient ? { ...existingPatient } : null;

  const patientRecord = {
    id: existingPatient ? existingPatient.id : uid(),
    surname: norm(draft.surname), name: norm(draft.name), middleName: norm(draft.middleName),
    gender: draft.gender || 'Ж',
    birthDay: parseInt(draft.birthDay, 10) || 0,
    birthMonth: parseInt(draft.birthMonth, 10) || 0,
    birthYear: parseInt(draft.birthYear, 10) || 0,
    cardNumber: norm(draft.cardNumber),
    height: parseInt(draft.height, 10) || null,
    weight: Number(String(draft.weight || '').replace(',', '.')) || null,
  };
  await put('patients', patientRecord);

  const previous = draft.id ? data.appointments.get(draft.id) : null;
  const now = new Date().toISOString();
  const record = {
    id: draft.id || uid(),
    date: toDate(draft.date).toISOString(),
    patientId: patientRecord.id,
    protocolNumber: norm(draft.protocolNumber),
    usSystemName: norm(draft.usSystemName),
    probeType: joinProbes(draft.probes),
    significantInfo: norm(draft.significantInfo),
    additionalInfo: norm(draft.additionalInfo),
    complications: norm(draft.complications),
    conclusion: norm(draft.conclusion),
    doctorName: norm(draft.doctorName),
    email: norm(draft.email),
    blocks: normalizeBlocks(draft.blocks),
    createdAt: previous ? previous.createdAt : now,
    updatedAt: now,
    deletedAt: null,
    changeLog: previous ? (previous.changeLog || []) : [],
  };
  if (previous) {
    const changes = describeChanges(previous, record, previous.patientId === patientRecord.id ? patientBefore : data.patients.get(previous.patientId), patientRecord);
    if (changes.length) record.changeLog = [...record.changeLog, { at: now, changes }].slice(-100);
  }
  await put('appointments', record);

  // Если у записи сменился пациент — прежнего без записей убираем.
  if (previous && previous.patientId && previous.patientId !== patientRecord.id) {
    await removeOrphanPatient(previous.patientId);
  }

  // Запоминаем врача, аппарат и датчики для следующих записей.
  const patch = {};
  if (record.doctorName) patch.doctorName = record.doctorName;
  if (record.usSystemName) patch.usSystemName = record.usSystemName;
  if (Object.keys(patch).length) setSettings(patch);
  const remembered = [];
  if (record.usSystemName) remembered.push({ id: 'machine:' + record.usSystemName, kind: 'machine', name: record.usSystemName, lastUsedAt: now });
  for (const p of splitProbes(record.probeType)) remembered.push({ id: 'probe:' + p, kind: 'probe', name: p, lastUsedAt: now });
  await putMany('catalog', remembered);

  return record.id;
}

/** Недавние аппараты или датчики: последние использованные первыми. */
export function catalogItems(kind) {
  return list('catalog').filter((c) => c.kind === kind)
    .sort((a, b) => String(b.lastUsedAt).localeCompare(String(a.lastUsedAt)))
    .map((c) => c.name);
}
export const forgetCatalogItem = (kind, name) => remove('catalog', kind + ':' + name);

async function removeOrphanPatient(patientId) {
  const stillUsed = list('appointments').some((a) => a.patientId === patientId);
  if (!stillUsed && data.patients.has(patientId)) {
    await remove('patients', patientId);
    await removeMediaOf({ patientIds: [patientId] });
  }
}

// ---------- Корзина ----------

export const TRASH_DAYS = 30;

/** Удалить запись в корзину (хранится 30 дней). */
export async function deleteAppointment(id) {
  const a = data.appointments.get(id);
  if (!a) return;
  await put('appointments', { ...a, deletedAt: new Date().toISOString() });
}

export async function restoreAppointment(id) {
  const a = data.appointments.get(id);
  if (!a) return;
  await put('appointments', { ...a, deletedAt: null });
}

/** Удалить окончательно: все записи корзины или только те, что лежат дольше days дней. */
export async function purgeTrash(days = 0) {
  const limit = Date.now() - days * 86400000;
  const victims = trashedAppointments().filter((a) => new Date(a.deletedAt).getTime() <= limit);
  const patientIds = new Set(victims.map((a) => a.patientId).filter(Boolean));
  await removeMany('appointments', victims.map((a) => a.id));
  await removeMediaOf({ appointmentIds: victims.map((a) => a.id) });
  for (const pid of patientIds) await removeOrphanPatient(pid);
  return victims.length;
}

export function trashDaysLeft(a) {
  const passed = (Date.now() - new Date(a.deletedAt).getTime()) / 86400000;
  return Math.max(0, Math.ceil(TRASH_DAYS - passed));
}

/** Копия записи с новым номером протокола (тот же день и время, тот же пациент). */
export async function duplicateAppointment(id) {
  const a = data.appointments.get(id);
  if (!a) return null;
  const now = new Date().toISOString();
  const copy = {
    ...a,
    id: uid(),
    protocolNumber: generateProtocolNumber(a.date),
    createdAt: now, updatedAt: now, deletedAt: null, changeLog: [],
  };
  await put('appointments', copy);
  return copy.id;
}

// ---------- «Из прошлого» и шаблоны приёма ----------

/** Последнее исследование пациента, где есть эта система с данными. */
export function lastBlockFor(patientId, systemId, excludeId) {
  if (!patientId) return null;
  for (const a of patientStudies(patientId, excludeId)) {
    const block = normalizeBlocks(a.blocks).find((b) => b.system === systemId && b.enabled && hasContent(b));
    if (block) return { appointment: a, block };
  }
  return null;
}

/** Прошлые исследования пациента, из которых есть что копировать. */
export function studiesWithData(patientId, excludeId) {
  return patientStudies(patientId, excludeId).filter((a) => normalizeBlocks(a.blocks).some((b) => b.enabled));
}

/** «Заполнить из прошлого»: системы, измерения, аппарат, датчики, значимая и доп. информация. Заключение и осложнения не копируются. */
export function copyFromStudy(draft, a) {
  return {
    ...draft,
    blocks: normalizeBlocks(a.blocks),
    usSystemName: a.usSystemName || draft.usSystemName,
    probes: splitProbes(a.probeType).length ? splitProbes(a.probeType) : draft.probes,
    significantInfo: a.significantInfo || '',
    additionalInfo: a.additionalInfo || '',
  };
}

/** Применить шаблон приёма: включает его системы с измерениями и подставляет тексты. */
export function applyApptTemplate(draft, tpl) {
  const fromTpl = normalizeBlocks(tpl.blocks);
  const blocks = draft.blocks.map((b) => {
    const t = fromTpl.find((x) => x.system === b.system);
    return t && t.enabled ? t : b;
  });
  return {
    ...draft,
    blocks,
    usSystemName: tpl.usSystemName || draft.usSystemName,
    probes: splitProbes(tpl.probeType).length ? splitProbes(tpl.probeType) : draft.probes,
    significantInfo: tpl.significantInfo || draft.significantInfo,
    additionalInfo: tpl.additionalInfo || draft.additionalInfo,
    conclusion: tpl.conclusion ? (draft.conclusion.trim() ? draft.conclusion.trim() + '\n' + tpl.conclusion : tpl.conclusion) : draft.conclusion,
  };
}

/** Сохранить запись как шаблон приёма. */
export async function saveAsApptTemplate(appt, title) {
  await put('apptTemplates', {
    id: uid(),
    title: norm(title) || 'Шаблон приёма',
    usSystemName: appt.usSystemName || '',
    probeType: appt.probeType || '',
    blocks: normalizeBlocks(appt.blocks),
    significantInfo: appt.significantInfo || '',
    additionalInfo: appt.additionalInfo || '',
    conclusion: appt.conclusion || '',
    createdAt: new Date().toISOString(),
  });
}

export const templateSystems = (tpl) => normalizeBlocks(tpl.blocks).filter((b) => b.enabled).map((b) => systemById(b.system).short).join(', ');

// ---------- Клиника ----------

export function activeClinic() {
  const all = list('clinics');
  return all.find((c) => c.isActive) || null;
}

export async function setActiveClinic(id) {
  await putMany('clinics', list('clinics').map((c) => ({ ...c, isActive: c.id === id })));
}

// ---------- Поиск ----------

/** Глобальный поиск: ФИО, карта, номер протокола, текст заключения. */
export function searchAppointments(query, limit = 50) {
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 2) return [];
  const out = [];
  for (const a of appointmentsSorted().reverse()) {
    const p = patientOf(a);
    const hay = [patientName(p), p && p.cardNumber, a.protocolNumber, a.conclusion].filter(Boolean).join('\n').toLowerCase();
    if (hay.includes(q)) out.push(a);
    if (out.length >= limit) break;
  }
  return out;
}
