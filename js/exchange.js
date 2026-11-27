// Справочник норм: экспорт/импорт JSON, сравнение, версии. Перенос данных между версиями. Резервная копия базы.
import {
  data, list, put, putMany, replaceStore, replaceEverything, mergeEverything,
  getSettings, setSettings, getFlag, setFlag, STORES, KEYS,
  putMedia, getMediaData, removeMedia, pruneMediaData,
} from './db.js';
import { bufferToBase64, base64ToBuffer, orphanMediaIds } from './media.js';
import {
  REFERENCE_SEED, SEED_VERSION, DEFAULT_TEMPLATES, PATHOLOGY_SEED, APPT_TEMPLATE_SEED, SYSTEMS,
  DESCRIPTION_KEY, formatRange, appliesText, emptyBlock,
} from './models.js';
import { uid, fmtNum, fmtDateTime } from './util.js';

export const EXPORT_VERSION = 1;
const numOrNull = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/** Параметр в формате обмена. */
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
    variantOf: r.variantOf || '',
    gender: r.gender || '',
    minAge: r.minAge ?? null,
    maxAge: r.maxAge ?? null,
  };
}

export const sortedRefs = () => list('references').sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0));

export function makeExport(items) {
  return { version: EXPORT_VERSION, exportedAt: new Date().toISOString(), items: items.map(toItem) };
}

export const exportJSON = (items) => JSON.stringify(makeExport(items), null, 2);

/** Разбор и проверка файла. Принимает и { items: [...] }, и просто массив. Повторы ключей — берётся последнее значение. */
export function parseExport(text, requireItems = true) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    throw new Error('Файл не похож на JSON.');
  }
  if (Array.isArray(obj)) obj = { version: EXPORT_VERSION, exportedAt: '', items: obj };
  if (!obj || !Array.isArray(obj.items)) throw new Error('В файле нет списка items — это не экспорт справочника.');
  if (typeof obj.version === 'number' && obj.version > EXPORT_VERSION) {
    throw new Error(`Версия файла ${obj.version} не поддерживается (ожидается ${EXPORT_VERSION} или ниже).`);
  }
  if (requireItems && obj.items.length === 0) throw new Error('В файле нет параметров.');

  const bad = [];
  const items = obj.items.map((raw) => {
    const item = toItem({
      ...raw,
      minValue: numOrNull(raw.minValue), maxValue: numOrNull(raw.maxValue),
      minAge: numOrNull(raw.minAge), maxAge: numOrNull(raw.maxAge),
    });
    item.key = String(item.key || '').trim();
    if (item.gender !== 'М' && item.gender !== 'Ж') item.gender = '';
    const nums = [item.minValue, item.maxValue, item.minAge, item.maxAge];
    const badNum = nums.some((n) => n !== null && !Number.isFinite(n));
    const badRange = (item.minValue !== null && item.maxValue !== null && item.minValue > item.maxValue)
      || (item.minAge !== null && item.maxAge !== null && item.minAge > item.maxAge);
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
  ['variantOf', 'ref.field.variant'],
  ['gender', 'ref.field.gender'],
  ['minAge', 'ref.field.min_age'],
  ['maxAge', 'ref.field.max_age'],
];
const NUMERIC = new Set(['minValue', 'maxValue', 'minAge', 'maxAge']);

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
      const a = old[f] ?? (NUMERIC.has(f) ? null : '');
      const b = item[f] ?? (NUMERIC.has(f) ? null : '');
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

export function seedSummary(s) {
  const who = appliesText(s);
  return `${s.title}${who ? ' (' + who + ')' : ''}: ${formatRange(s.minValue, s.maxValue, s.unit)}`;
}

// ---------- Первичное заполнение и перенос данных между версиями ----------

const DATA_VERSION = 2;

/** Шаблон приёма из стартового описания: включённые системы с текстом описания, без чисел. */
function apptTemplateFromSeed(seed) {
  const blocks = SYSTEMS.map((s) => {
    const b = emptyBlock(s.id);
    if (seed.systems[s.id]) {
      b.enabled = true;
      b.fields[DESCRIPTION_KEY] = seed.systems[s.id];
    }
    return b;
  });
  return {
    id: uid(), title: seed.title, usSystemName: '', probeType: '', blocks,
    significantInfo: '', additionalInfo: '', conclusion: seed.conclusion, createdAt: new Date().toISOString(),
  };
}

/** Перенос данных версии 1 → 2. Можно выполнять повторно: ничего не испортит. */
async function migrateToV2() {
  // «Желчный» без «ё» и нормы по полу для щитовидной железы.
  const changed = [];
  for (const r of data.references.values()) {
    let next = null;
    if (r.organ === 'Жёлчный пузырь') next = { ...(next || r), organ: 'Желчный пузырь' };
    if (r.key === 'thyroid_volume' && !r.gender && !r.variantOf && /\(Ж\)/.test(r.title || '')) {
      next = { ...(next || r), title: 'Общий объём', gender: 'Ж' };
    }
    if (r.key === 'thyroid_volume_m' && !r.variantOf && /\(М\)/.test(r.title || '')) {
      next = { ...(next || r), title: 'Общий объём', variantOf: 'thyroid_volume', gender: 'М' };
    }
    if (next) changed.push(next);
  }
  await putMany('references', changed);

  const fixedTemplates = [];
  for (const x of data.templates.values()) {
    const title = String(x.title || '').replace(/Жёлчн/g, 'Желчн').replace(/жёлчн/g, 'желчн');
    const text = String(x.text || '').replace(/Жёлчн/g, 'Желчн').replace(/жёлчн/g, 'желчн');
    if (title !== x.title || text !== x.text) fixedTemplates.push({ ...x, title, text });
  }
  await putMany('templates', fixedTemplates);

  // Шапка протокола из настроек версии 1 становится первым профилем клиники.
  const s = getSettings();
  if (data.clinics.size === 0 && ((s.orgName || '').trim() || (s.orgAddress || '').trim())) {
    await put('clinics', {
      id: uid(), name: (s.orgName || '').trim(), address: (s.orgAddress || '').trim(),
      phone: '', email: '', logo: '', isActive: true,
    });
  }

  // Аппарат и датчики из старых записей — в список «недавних».
  const entries = new Map();
  for (const a of data.appointments.values()) {
    const at = a.date || new Date().toISOString();
    const remember = (kind, name) => {
      const n = String(name || '').trim();
      if (!n) return;
      const id = kind + ':' + n;
      if (!data.catalog.has(id) && (!entries.has(id) || entries.get(id).lastUsedAt < at)) entries.set(id, { id, kind, name: n, lastUsedAt: at });
    };
    remember('machine', a.usSystemName);
    String(a.probeType || '').split(';').forEach((p) => remember('probe', p));
  }
  await putMany('catalog', Array.from(entries.values()));
}

export async function ensureSeed() {
  // 1. Справочник норм: первое заполнение и новые ключи при обновлении приложения.
  const stored = Number(getFlag('refSeedVersion') || 0);
  if (stored < SEED_VERSION) {
    const existing = sortedRefs();
    const keys = new Set(existing.map((r) => r.key));
    const next = existing.reduce((m, r) => Math.max(m, r.sortIndex ?? 0), -1) + 1;
    const missing = REFERENCE_SEED.filter((s) => !keys.has(s.key));
    if (missing.length) {
      await putMany('references', missing.map((s, i) => ({
        ...toItem(s),
        sortIndex: existing.length ? next + i : REFERENCE_SEED.indexOf(s),
      })));
    }
    if (!existing.length) await snapshot('Исходные значения');
    setFlag('refSeedVersion', SEED_VERSION);
  }

  // 2. Шаблоны заключений.
  if (!getFlag('templatesSeeded')) {
    if (data.templates.size === 0) {
      const now = Date.now();
      await putMany('templates', DEFAULT_TEMPLATES.map(([title, text, system], i) => ({
        id: uid(), title, text, system, createdAt: new Date(now + i).toISOString(),
      })));
    }
    setFlag('templatesSeeded', 1);
  }

  // 3. Перенос данных прежней версии.
  if (Number(getFlag('dataVersion') || 0) < DATA_VERSION) {
    await migrateToV2();
    setFlag('dataVersion', DATA_VERSION);
  }

  // 4. Справочник патологий и шаблоны приёма.
  if (!getFlag('pathologiesSeeded')) {
    if (data.pathologies.size === 0) {
      await putMany('pathologies', PATHOLOGY_SEED.map(([title, text, system]) => ({ id: uid(), title, text, system })));
    }
    setFlag('pathologiesSeeded', 1);
  }
  if (!getFlag('apptTemplatesSeeded')) {
    if (data.apptTemplates.size === 0) await putMany('apptTemplates', APPT_TEMPLATE_SEED.map(apptTemplateFromSeed));
    setFlag('apptTemplatesSeeded', 1);
  }
}

// ---------- Полная резервная копия ----------

// Описания медиа хранятся в копии вместе с файлами (раздел media), а не отдельным списком.
const BACKUP_STORES = STORES.filter((name) => name !== 'mediaMeta');

/**
 * Резервная копия всей базы. С медиа файл собирается по частям,
 * чтобы не держать все фото и видео в памяти одной строкой.
 */
export async function makeBackupBlob(includeMedia = false) {
  const out = { app: 'uzi-protocols', backupVersion: 3, exportedAt: new Date().toISOString(), settings: getSettings() };
  for (const s of BACKUP_STORES) out[s] = list(s);
  if (!includeMedia) return new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });

  const head = JSON.stringify(out);
  const parts = [head.slice(0, -1), ',"media":['];
  let first = true;
  for (const meta of list('mediaMeta')) {
    const buffer = await getMediaData(meta.id);
    if (!buffer) continue;
    const base64 = await bufferToBase64(buffer, meta.mime);
    parts.push(new Blob([first ? '' : ',', JSON.stringify(meta).slice(0, -1), ',"dataBase64":"', base64, '"}']));
    first = false;
  }
  parts.push(']}');
  return new Blob(parts, { type: 'application/json' });
}

export function parseBackup(text) {
  let obj;
  try { obj = JSON.parse(text); } catch (e) { throw new Error('Файл не похож на JSON.'); }
  if (!obj || obj.app !== 'uzi-protocols' || !Array.isArray(obj.appointments)) {
    throw new Error('Это не резервная копия «УЗИ-протоколов».');
  }
  for (const s of BACKUP_STORES) {
    if (obj[s] !== undefined && !Array.isArray(obj[s])) throw new Error('Копия повреждена: раздел «' + s + '» не является списком.');
    const key = KEYS[s];
    if ((obj[s] || []).some((o) => !o || o[key] === undefined || o[key] === null || o[key] === '')) {
      throw new Error('Копия повреждена: в разделе «' + s + '» есть записи без идентификатора.');
    }
  }
  if (obj.media !== undefined) {
    if (!Array.isArray(obj.media) || obj.media.some((m) => !m || !m.id || typeof m.dataBase64 !== 'string')) {
      throw new Error('Копия повреждена: раздел с фото и видео не читается.');
    }
  }
  return obj;
}

/** Сколько записей в копии новые, а сколько уже есть в базе (по идентификатору). */
export function backupStats(obj) {
  const count = (s) => {
    const items = obj[s] || [];
    const existing = items.filter((o) => data[s].has(o[KEYS[s]])).length;
    return { total: items.length, existing, fresh: items.length - existing };
  };
  return {
    exportedAt: obj.exportedAt || '',
    appointments: count('appointments'),
    patients: count('patients'),
    references: count('references'),
    templates: count('templates'),
    media: Array.isArray(obj.media) ? obj.media.length : null,
  };
}

const metaOf = (m) => { const { dataBase64, ...meta } = m; return meta; };

/**
 * Восстановление из копии.
 * replaceAll — заменить всё; merge — обновить совпадающие и добавить новые; skipExisting — добавить только новые.
 * Копия без медиа не трогает фото и видео тех записей, которые остаются в базе.
 */
export async function restoreBackup(obj, strategy = 'replaceAll') {
  const hasMedia = Array.isArray(obj.media);

  if (strategy === 'replaceAll') {
    const snapshot = { ...obj, mediaMeta: [] };
    if (!hasMedia) {
      const appointmentIds = new Set((obj.appointments || []).map((a) => a.id));
      const patientIds = new Set((obj.patients || []).map((p) => p.id));
      snapshot.mediaMeta = list('mediaMeta').filter((m) => (m.appointmentId ? appointmentIds.has(m.appointmentId) : patientIds.has(m.patientId)));
    }
    await replaceEverything(snapshot);
    if (hasMedia) {
      for (const m of obj.media) await putMedia(metaOf(m), await base64ToBuffer(m.dataBase64));
    }
    await pruneMediaData();
    if (obj.settings && typeof obj.settings === 'object') setSettings(obj.settings);
    setFlag('refSeedVersion', obj.backupVersion >= 2 ? SEED_VERSION : 1);
    setFlag('templatesSeeded', 1);
    setFlag('dataVersion', obj.backupVersion >= 2 ? DATA_VERSION : 1);
    if (!(obj.backupVersion >= 2)) {
      setFlag('pathologiesSeeded', '');
      setFlag('apptTemplatesSeeded', '');
    }
    await ensureSeed(); // старую копию доводим до текущей версии данных
    return;
  }

  const partial = {};
  for (const s of BACKUP_STORES) {
    const items = obj[s] || [];
    partial[s] = strategy === 'merge' ? items : items.filter((o) => !data[s].has(o[KEYS[s]]));
  }
  await mergeEverything(partial);
  if (hasMedia) {
    for (const m of obj.media) {
      if (strategy === 'merge' || !data.mediaMeta.has(m.id)) await putMedia(metaOf(m), await base64ToBuffer(m.dataBase64));
    }
  }
  await removeMedia(orphanMediaIds());
  await migrateToV2();
}
