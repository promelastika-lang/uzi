// Точка входа: загрузка базы, маршруты, тема.
import { html, render, useEffect } from '../vendor/standalone.module.js';
import { initDB, useData, getSettings } from './db.js';
import { ensureSeed } from './exchange.js';
import { useRoute } from './router.js';
import { lang } from './i18n.js';
import { DialogHost, ToastHost } from './ui.js';
import { CalendarScreen, DayScreen } from './views/calendar.js';
import { EditScreen, DetailScreen } from './views/appointment.js';
import { ReferencesScreen, ReferenceEditScreen, ExchangeScreen, VersionsScreen } from './views/references.js';
import { StatsScreen, TemplatesScreen, SettingsScreen } from './views/other.js';

window.UZI_VERSION = '1.0.0';

function applyTheme() {
  const s = getSettings();
  const root = document.documentElement;
  if (s.theme === 'light' || s.theme === 'dark') root.setAttribute('data-theme', s.theme);
  else root.removeAttribute('data-theme');
  root.setAttribute('lang', lang());
  const dark = s.theme === 'dark' || (s.theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#000000' : '#f2f2f7');
}

function route(path) {
  const parts = path.split('/').filter(Boolean);
  const [a, b, c] = parts;
  if (!a) return html`<${CalendarScreen} />`;
  if (a === 'day' && b) return html`<${DayScreen} key=${'day' + b} dayKeyValue=${b} />`;
  if (a === 'new') return html`<${EditScreen} key=${'new' + (b || '')} dayKeyValue=${b} />`;
  if (a === 'edit' && b) return html`<${EditScreen} key=${'edit' + b} id=${b} />`;
  if (a === 'a' && b) return html`<${DetailScreen} key=${'a' + b} id=${b} />`;
  if (a === 'refs' && b === 'exchange') return html`<${ExchangeScreen} />`;
  if (a === 'refs' && b === 'versions') return html`<${VersionsScreen} />`;
  if (a === 'refs' && !c) return html`<${ReferencesScreen} />`;
  if (a === 'ref' && b) return html`<${ReferenceEditScreen} key=${'ref' + b} refKey=${b} />`;
  if (a === 'stats') return html`<${StatsScreen} />`;
  if (a === 'templates') return html`<${TemplatesScreen} />`;
  if (a === 'settings') return html`<${SettingsScreen} />`;
  return html`<${CalendarScreen} />`;
}

function App() {
  useData(); // перерисовка при смене языка и темы
  const path = useRoute();
  useEffect(() => { applyTheme(); });
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const fn = () => applyTheme();
    if (mq.addEventListener) mq.addEventListener('change', fn);
    return () => { if (mq.removeEventListener) mq.removeEventListener('change', fn); };
  }, []);
  return html`${route(path)}<${DialogHost} /><${ToastHost} />`;
}

function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function showFatal(message) {
  const el = document.getElementById('app');
  clear(el);
  const box = document.createElement('div');
  box.className = 'fatal';
  box.textContent = 'Не удалось запустить приложение: ' + message;
  el.appendChild(box);
}

async function start() {
  try {
    applyTheme();
    await initDB();
    await ensureSeed();
    const root = document.getElementById('app');
    clear(root);
    render(html`<${App} />`, root);
  } catch (e) {
    console.error(e);
    showFatal(String((e && e.message) || e));
  }
  // Работа без интернета: только по https. На localhost — лишь с ?sw в адресе, чтобы кеш не мешал разработке.
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || (local && location.search.includes('sw')))) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

start();
