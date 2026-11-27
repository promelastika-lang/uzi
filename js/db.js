// Хранилище: IndexedDB в телефоне + копия в памяти для быстрого отображения.
// Никакие данные не уходят с устройства.
import { useState, useEffect } from '../vendor/standalone.module.js';

const DB_NAME = 'uzi-protocols';
const DB_VERSION = 2;

// Таблицы, которые целиком держим в памяти.
export const KEYS = {
  patients: 'id',
  appointments: 'id',
  references: 'key',
  versions: 'id',
  templates: 'id',       // шаблоны заключений
  pathologies: 'id',     // справочник патологий
  apptTemplates: 'id',   // шаблоны приёма
  clinics: 'id',         // профили клиник
  catalog: 'id',         // УЗ-аппараты и датчики: «machine:Название», «probe:Название»
};
export const STORES = Object.keys(KEYS);
// Медиа (фото, видео, аудио) лежит отдельно и в память не загружается.
const MEDIA_STORE = 'media';

export const data = {};
for (const s of STORES) data[s] = new Map();

let db = null;
const listeners = new Set();
let version = 0;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function notify() {
  version += 1;
  listeners.forEach((fn) => fn(version));
}

/** Хук: перерисовать компонент при любом изменении данных или настроек. */
export function useData() {
  const [, setV] = useState(0);
  useEffect(() => subscribe((v) => setV(v)), []);
  return data;
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      for (const s of STORES) {
        if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: KEYS[s] });
      }
      if (!d.objectStoreNames.contains(MEDIA_STORE)) d.createObjectStore(MEDIA_STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => {
      // Если приложение открыто в другой вкладке со старой версией — уступаем обновлению.
      req.result.onversionchange = () => { req.result.close(); };
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('База данных занята другой вкладкой. Закройте её и обновите страницу.'));
  });
}

function run(stores, mode, work) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    try {
      result = work(t);
    } catch (e) {
      t.abort();
      reject(e);
      return;
    }
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Транзакция отменена'));
  });
}

function getAll(store) {
  return new Promise((resolve, reject) => {
    const req = db.transaction([store], 'readonly').objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function initDB() {
  db = await openDB();
  for (const s of STORES) {
    const all = await getAll(s);
    data[s] = new Map(all.map((o) => [o[KEYS[s]], o]));
  }
  // Просим браузер не удалять данные при нехватке места.
  if (navigator.storage && navigator.storage.persist) {
    try { await navigator.storage.persist(); } catch (e) { /* не критично */ }
  }
}

const clone = (o) => JSON.parse(JSON.stringify(o));

export async function put(store, obj) {
  const copy = clone(obj);
  await run([store], 'readwrite', (t) => t.objectStore(store).put(copy));
  data[store].set(copy[KEYS[store]], copy);
  notify();
  return copy;
}

export async function putMany(store, objs) {
  if (!objs.length) return;
  const copies = objs.map(clone);
  await run([store], 'readwrite', (t) => {
    const os = t.objectStore(store);
    copies.forEach((o) => os.put(o));
  });
  copies.forEach((o) => data[store].set(o[KEYS[store]], o));
  notify();
}

export async function remove(store, key) {
  await run([store], 'readwrite', (t) => t.objectStore(store).delete(key));
  data[store].delete(key);
  notify();
}

export async function removeMany(store, keys) {
  if (!keys.length) return;
  await run([store], 'readwrite', (t) => {
    const os = t.objectStore(store);
    keys.forEach((k) => os.delete(k));
  });
  keys.forEach((k) => data[store].delete(k));
  notify();
}

/** Полностью заменить содержимое одной таблицы (одной транзакцией). */
export async function replaceStore(store, objs) {
  const copies = objs.map(clone);
  await run([store], 'readwrite', (t) => {
    const os = t.objectStore(store);
    os.clear();
    copies.forEach((o) => os.put(o));
  });
  data[store] = new Map(copies.map((o) => [o[KEYS[store]], o]));
  notify();
}

/** Восстановление из полной резервной копии: все таблицы одной транзакцией. */
export async function replaceEverything(snapshot) {
  const prepared = {};
  for (const s of STORES) prepared[s] = (snapshot[s] || []).map(clone);
  await run(STORES, 'readwrite', (t) => {
    for (const s of STORES) {
      const os = t.objectStore(s);
      os.clear();
      prepared[s].forEach((o) => os.put(o));
    }
  });
  for (const s of STORES) data[s] = new Map(prepared[s].map((o) => [o[KEYS[s]], o]));
  notify();
}

/** Дописать записи сразу в несколько таблиц одной транзакцией (импорт копии «объединить» / «только новые»). */
export async function mergeEverything(partial) {
  const prepared = {};
  for (const s of STORES) prepared[s] = (partial[s] || []).map(clone);
  await run(STORES, 'readwrite', (t) => {
    for (const s of STORES) {
      const os = t.objectStore(s);
      prepared[s].forEach((o) => os.put(o));
    }
  });
  for (const s of STORES) prepared[s].forEach((o) => data[s].set(o[KEYS[s]], o));
  notify();
}

export const list = (store) => Array.from(data[store].values());

// ---------- Настройки (в localStorage) ----------

const SETTINGS_KEY = 'uzi-settings';
const DEFAULT_SETTINGS = {
  lang: 'ru',
  theme: 'system',
  calendarMode: 'month',
  doctorName: '',
  usSystemName: '',
  orgName: '',       // до версии 2 — шапка протокола; теперь профили клиник
  orgAddress: '',
  pdfLogo: true,
  pdfSources: true,
  pdfSignature: true,
  pdfFontScale: 1,
  remindMinutes: 15,
  onboardingDone: false,
  lastBackupAt: '',
};
let settingsCache = null;

export function getSettings() {
  if (!settingsCache) {
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch (e) { stored = {}; }
    settingsCache = { ...DEFAULT_SETTINGS, ...stored };
  }
  return settingsCache;
}

export function setSettings(patch) {
  settingsCache = { ...getSettings(), ...patch };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settingsCache)); } catch (e) { /* приватный режим */ }
  notify();
}

export function getFlag(name) {
  try { return localStorage.getItem('uzi-flag-' + name); } catch (e) { return null; }
}
export function setFlag(name, value) {
  try { localStorage.setItem('uzi-flag-' + name, String(value)); } catch (e) { /* ignore */ }
}

/** Небольшие данные «на потом»: черновик записи, последние значения полей. */
export function getLocal(name, fallback) {
  try {
    const raw = localStorage.getItem('uzi-' + name);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (e) { return fallback; }
}
export function setLocal(name, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem('uzi-' + name);
    else localStorage.setItem('uzi-' + name, JSON.stringify(value));
  } catch (e) { /* ignore */ }
}
