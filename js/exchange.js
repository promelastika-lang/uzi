// Справочник норм: экспорт/импорт JSON, сравнение, версии. Полная резервная копия базы.
import { data, list, put, putMany, replaceStore, replaceEverything, getSettings, setSettings, getFlag, setFlag, STORES } from './db.js';
import { REFERENCE_SEED, SEED_VERSION, DEFAULT_TEMPLATES, formatRange } from './models.js';
import { uid, fmtNum, fmtDateTime } from './util.js';

export const EXPORT_VERSION = 1;

/** Параметр в формате обмена (порядок полей как в ТЗ). */
export function toItem(r) {
  return {
    key: r.key,
    organ: r.organ || '',
    title: r.title || '',
    unit: r.unit || '',
    minValue: r.minValue ?? null,
    maxValue: r.maxValue ?? null,
    source: r.source || '',
    sourcePage: r.sourcePage || '',
    note: r.note || '',
  };
}

export const sortedRefs = () => list('references').sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0));

export function makeExport(items) {
  return { version: EXPORT_VERSION, exportedAt: new Date().toISOString(), items: items.map(toItem) };
}

export const exportJSON = (items) => JSON.stringify(makeExport(items), null, 2);

/** Разбор и проверка файла. Повторяющиеся ключи — берётся последнее значение. */
export function parseExport(text, requireItems = true) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    throw new Error('Файл не похож на JSON.');
  }
  if (!obj || !Array.isArray(obj.items)) throw new Error('В файле нет списка items — это не экспорт справочника.');
  if (typeof obj.version === 'number' && obj.version > EXPORT_VERSION) {
    throw new Error(`Версия файла ${obj.version} не поддерживается (ожидается ${EXPORT_VERSION} или ниже).`);
  }
  if (requireItems && obj.items.length === 0) throw new Error('В файле нет параметров.');

  const bad = [];
  const toNum = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
  const items = obj.items.map((raw) => {
    const item = toItem({ ...raw, minValue: toNum(raw.minValue), maxValue: toNum(raw.maxValue) });
    item.key = String(item.key || '').trim();
    const badNum = (item.minValue !== null && !Number.isFinite(item.minValue)) || (item.maxValue !== null && !Number.isFinite(item.maxValue));
    const badRange = item.minValue !== null && item.maxValue !== null && item.minValue > item.maxValue;
    if (!item.key || badNum || badRange) bad.push(item.key || '(без key)');
    return item;
  });
  if (bad.length) {
    throw new Error('Ошибки в параметрах: ' + bad.join(', ') + '. У каждого должен быть key, числа в min/max, и min не больше max.');
  }

  const last = new Map();
  const order = [];
  for (const it of items) {
    if (!last.has(it.key)) order.push(it.key);
    last.set(it.key, it);
  }
  return { version: obj.version ?? EXPORT_VERSION, exportedAt: obj.exportedAt || '', items: order.map((k) => last.get(k)) };
}

// ---------- Сравнение ----------

const FIELDS = [
  ['organ', 'ref.field.organ'],
  ['title', 'ref.field.title'],
  ['unit', 'ref.field.unit'],
  ['minValue', 'ref.field.min'],
  ['maxValue', 'ref.field.max'],
  ['source', 'ref.field.source'],
  ['sourcePage', 'ref.field.page'],
  ['note', 'ref.field.note'],
];

const show = (v) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'number' ? fmtNum(v) : String(v));

export function diffItems(current, incoming) {
  const cur = new Map(current.map((i) => [i.key, i]));
  const inc = new Map(incoming.map((i) => [i.key, i]));
  const entries = [];
  for (const item of incoming) {
    const old = cur.get(item.key);
    if (!old) {
      entries.push({ key: item.key, kind: 'added', current: null, incoming: item, changes: [] });
      continue;
    }
    const changes = [];
    for (const [f, label] of FIELDS) {
      const a = old[f] ?? (f.endsWith('Value') ? null : '');
      const b = item[f] ?? (f.endsWith('Value') ? null : '');
      if (a !== b) changes.push({ field: label, old: show(a), new: show(b) });
    }
    entries.push({ key: item.key, kind: changes.length ? 'changed' : 'unchanged', current: old, incoming: item, changes });
  }
  for (const item of current) {
    if (!inc.has(item.key)) entries.push({ key: item.key, kind: 'removed', current: item, incoming: null, changes: [] });
  }
  const by = (k) => entries.filter((e) => e.kind === k);
  return { entries, added: by('added'), changed: by('changed'), removed: by('removed'), unchanged: by('unchanged') };
}

export function diffEffect(diff, strategy) {
  if (strategy === 'merge') return { add: diff.added.length, update: diff.changed.length, remove: 0 };
  if (strategy === 'skipExisting') return { add: diff.added.length, update: 0, remove: 0 };
  return { add: diff.added.length, update: diff.changed.length, remove: diff.removed.length }; // replaceAll
}

/** Применить импорт: merge / skipExisting / replaceAll. Снимки версий делает вызывающий код. */
export async function applyImport(items, strategy) {
  if (strategy === 'replaceAll') {
    await replaceStore('references', items.map((it, i) => ({ ...toItem(it), sortIndex: i })));
    return;
  }
  const existing = sortedRefs();
  const byKey = new Map(existing.map((r) => [r.key, r]));
  let next = existing.reduce((m, r) => Math.max(m, r.sortIndex ?? 0), -1) + 1;
  const toPut = [];
  for (const it of items) {
    const old = byKey.get(it.key);
    if (old) {
      if (strategy === 'merge') toPut.push({ ...toItem(it), sortIndex: old.sortIndex ?? 0 });
    } else {
      toPut.push({ ...toItem(it), sortIndex: next++ });
    }
  }
  if (toPut.length) await putMany('references', toPut);
}

// ---------- Версии ----------

export async function snapshot(note) {
  const items = sortedRefs().map(toItem);
  const v = {
    id: uid(),
    createdAt: new Date().toISOString(),
    note: note || '',
    itemCount: items.length,
    snapshotJSON: exportJSON(items),
  };
  await put('versions', v);
  return v;
}

export async function restoreVersion(v) {
  const parsed = parseExport(v.snapshotJSON, false);
  await snapshot('Перед откатом к «' + (v.note || fmtDateTime(v.createdAt)) + '»');
  await applyImport(parsed.items, 'replaceAll');
}

export async function resetToDefaults() {
  await snapshot('Перед сбросом к исходным значениям');
  await applyImport(REFERENCE_SEED, 'replaceAll');
}

export const seedSummary = (s) => `${s.title}: ${formatRange(s.minValue, s.maxValue, s.unit)}`;

// ---------- Первичное заполнение ----------

export async function ensureSeed() {
  const stored = Number(getFlag('refSeedVersion') || 0);
  if (stored < SEED_VERSION) {
    const existing = sortedRefs();
    const keys = new Set(existing.map((r) => r.key));
    let next = existing.reduce((m, r) => Math.max(m, r.sortIndex ?? 0), -1) + 1;
    const missing = REFERENCE_SEED.filter((s) => !keys.has(s.key));
    if (missing.length) {
      await putMany('references', missing.map((s, i) => ({ ...toItem(s), sortIndex: existing.length ? next + i : REFERENCE_SEED.indexOf(s) })));
    }
    if (!existing.length) await snapshot('Исходные значения');
    setFlag('refSeedVersion', SEED_VERSION);
  }
  if (!getFlag('templatesSeeded')) {
    if (data.templates.size === 0) {
      const now = Date.now();
      await putMany('templates', DEFAULT_TEMPLATES.map(([title, text, system], i) => ({
        id: uid(), title, text, system, createdAt: new Date(now + i).toISOString(),
      })));
    }
    setFlag('templatesSeeded', 1);
  }
}

// ---------- Полная резервная копия ----------

export function makeBackup() {
  const out = { app: 'uzi-protocols', backupVersion: 1, exportedAt: new Date().toISOString(), settings: getSettings() };
  for (const s of STORES) out[s] = list(s);
  return JSON.stringify(out, null, 1);
}

export function parseBackup(text) {
  let obj;
  try { obj = JSON.parse(text); } catch (e) { throw new Error('Файл не похож на JSON.'); }
  if (!obj || obj.app !== 'uzi-protocols' || !Array.isArray(obj.appointments)) {
    throw new Error('Это не резервная копия «УЗИ-протоколов».');
  }
  return obj;
}

export async function restoreBackup(obj) {
  await replaceEverything(obj);
  if (obj.settings && typeof obj.settings === 'object') setSettings(obj.settings);
  setFlag('refSeedVersion', SEED_VERSION);
  setFlag('templatesSeeded', 1);
}

export function backupStats(obj) {
  return {
    patients: (obj.patients || []).length,
    appointments: (obj.appointments || []).length,
    references: (obj.references || []).length,
    templates: (obj.templates || []).length,
    exportedAt: obj.exportedAt || '',
  };
}
