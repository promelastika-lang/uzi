// Общие элементы интерфейса в стиле iOS.
import { html, useState, useEffect, useRef } from '../vendor/standalone.module.js';
import { t } from './i18n.js';
import { back, navigate, currentPath } from './router.js';

// ---------- Иконки ----------

const PATHS = {
  calendar: 'M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  chart: 'M5 20V10M12 20V4M19 20v-7',
  book: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4zM5 17a3 3 0 0 1 3-3h11',
  text: 'M5 6h14M5 10h14M5 14h9M5 18h6',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.07-.4.1-.8.1-1.2z',
  plus: 'M12 5v14M5 12h14',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6',
  share: 'M12 15V3M8 7l4-4 4 4M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7',
  download: 'M12 3v12M8 11l4 4 4-4M5 20h14',
  doc: 'M7 3h7l5 5v13H7V3zM14 3v5h5M10 13h6M10 17h6',
  mail: 'M4 6h16v12H4V6zM4 7l8 6 8-6',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5',
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  pencil: 'M4 20l1-5L16 4l4 4L9 19l-5 1zM14 6l4 4',
  swap: 'M7 4v16M7 4L3 8M7 4l4 4M17 20V4M17 20l-4-4M17 20l4-4',
  check: 'M5 12l5 5 9-10',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5v.5',
};

export function Icon({ name, size = 22 }) {
  return html`<svg class="icon" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${PATHS[name] || ''} /></svg>`;
}

// ---------- Экран ----------

const TABS = [
  { path: '/', icon: 'calendar', key: 'schedule' },
  { path: '/stats', icon: 'chart', key: 'statistics' },
  { path: '/refs', icon: 'book', key: 'tab.references' },
  { path: '/templates', icon: 'text', key: 'templates' },
  { path: '/settings', icon: 'gear', key: 'settings' },
];

/**
 * Каркас экрана: шапка с заголовком, кнопкой «Назад» и действиями.
 * backTo — запасной адрес для кнопки «Назад»; tabs — показывать нижнюю панель.
 */
export function Screen({ title, backTo, left, right, tabs, children }) {
  const path = currentPath();
  return html`
    <div class="screen">
      <header class="nav">
        <div class="nav-side nav-left">
          ${backTo !== undefined
            ? html`<button class="nav-btn" onClick=${() => back(backTo)}><${Icon} name="left" size=${20} /><span>${t('common.back')}</span></button>`
            : left}
        </div>
        <h1 class="nav-title">${title}</h1>
        <div class="nav-side nav-right">${right}</div>
      </header>
      <main class=${'content' + (tabs ? ' with-tabs' : '')}>${children}</main>
      ${tabs && html`
        <nav class="tabbar">
          ${TABS.map((tab) => html`
            <button key=${tab.path} class=${'tab' + (path === tab.path ? ' active' : '')}
              onClick=${() => { if (path !== tab.path) navigate(tab.path); }}>
              <${Icon} name=${tab.icon} size=${24} />
              <span>${t(tab.key)}</span>
            </button>`)}
        </nav>`}
    </div>`;
}

export function NavButton({ icon, label, onClick, disabled, strong }) {
  return html`<button class=${'nav-btn' + (strong ? ' strong' : '')} onClick=${onClick} disabled=${disabled} aria-label=${label}>
    ${icon ? html`<${Icon} name=${icon} />` : html`<span>${label}</span>`}
  </button>`;
}

// ---------- Группы и строки ----------

export function Group({ title, footer, children }) {
  return html`
    <section class="group">
      ${title && html`<h2 class="group-title">${title}</h2>`}
      <div class="card">${children}</div>
      ${footer && html`<p class="group-footer">${footer}</p>`}
    </section>`;
}

/** Строка «подпись — значение». С onClick становится кнопкой. */
export function Row({ label, value, sub, onClick, chevron, icon, destructive, accent, children }) {
  const cls = 'row' + (onClick ? ' tappable' : '') + (destructive ? ' destructive' : '') + (accent ? ' accent' : '');
  const body = html`
    ${icon && html`<span class="row-icon"><${Icon} name=${icon} /></span>`}
    <span class="row-main">
      <span class="row-label">${label}</span>
      ${sub && html`<span class="row-sub">${sub}</span>`}
    </span>
    ${value !== undefined && value !== null && html`<span class=${'row-value' + (typeof value === 'string' && value.length <= 14 ? ' short' : '')}>${value}</span>`}
    ${children}
    ${chevron && html`<span class="row-chevron"><${Icon} name="right" size=${16} /></span>`}`;
  return onClick
    ? html`<button class=${cls} onClick=${onClick}>${body}</button>`
    : html`<div class=${cls}>${body}</div>`;
}

/** Подпись сверху, текст снизу (для длинных значений). */
export function StackRow({ label, value }) {
  return html`<div class="row stack">
    <span class="row-caption">${label}</span>
    <span class="row-text">${value && String(value).trim() ? value : '—'}</span>
  </div>`;
}

/** Поле ввода в одну строку. */
export function TextRow({ label, value, onInput, type = 'text', inputmode, placeholder = '', autocapitalize, children }) {
  return html`<label class="row field">
    <span class="row-label">${label}</span>
    <input class="input" type=${type} inputmode=${inputmode} value=${value} placeholder=${placeholder}
      autocapitalize=${autocapitalize} autocomplete="off"
      onInput=${(e) => onInput(e.target.value)} />
    ${children}
  </label>`;
}

/** Многострочное поле с подписью сверху, растёт по тексту. */
export function AreaRow({ label, value, onInput, placeholder = '', minRows = 2 }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.max(el.scrollHeight, minRows * 22) + 'px';
  }, [value]);
  return html`<label class="row stack">
    ${label && html`<span class="row-caption">${label}</span>`}
    <textarea ref=${ref} class="textarea" rows=${minRows} value=${value} placeholder=${placeholder}
      onInput=${(e) => onInput(e.target.value)}></textarea>
  </label>`;
}

export function ToggleRow({ label, checked, onChange, icon }) {
  return html`<label class="row toggle-row">
    ${icon && html`<span class="row-icon"><${Icon} name=${icon} /></span>`}
    <span class="row-label">${label}</span>
    <input type="checkbox" class="switch" checked=${checked} onChange=${(e) => onChange(e.target.checked)} />
  </label>`;
}

export function SelectRow({ label, value, options, onChange }) {
  return html`<label class="row field">
    <span class="row-label">${label}</span>
    <select class="select" value=${value} onChange=${(e) => onChange(e.target.value)}>
      ${options.map((o) => html`<option key=${o.value} value=${o.value} selected=${o.value === value}>${o.label}</option>`)}
    </select>
  </label>`;
}

export function Segmented({ options, value, onChange }) {
  return html`<div class="segmented" role="tablist">
    ${options.map((o) => html`<button key=${o.value} role="tab" class=${o.value === value ? 'active' : ''}
      onClick=${() => onChange(o.value)}>${o.label}</button>`)}
  </div>`;
}

export function Empty({ icon = 'info', text }) {
  return html`<div class="empty"><${Icon} name=${icon} size=${44} /><p>${text}</p></div>`;
}

export function SearchBox({ value, onInput, placeholder }) {
  return html`<div class="search"><input class="search-input" type="search" value=${value}
    placeholder=${placeholder || t('common.search')} onInput=${(e) => onInput(e.target.value)} /></div>`;
}

// ---------- Модальное окно на весь экран ----------

export function Sheet({ title, onClose, onDone, doneLabel, doneDisabled, closeLabel, children }) {
  useEffect(() => {
    document.body.classList.add('sheet-open');
    return () => document.body.classList.remove('sheet-open');
  }, []);
  return html`
    <div class="sheet-backdrop">
      <div class="sheet" role="dialog" aria-modal="true">
        <header class="nav">
          <div class="nav-side nav-left">
            ${onClose && html`<button class="nav-btn" onClick=${onClose}><span>${closeLabel || t('common.cancel')}</span></button>`}
          </div>
          <h1 class="nav-title">${title}</h1>
          <div class="nav-side nav-right">
            ${onDone && html`<button class="nav-btn strong" disabled=${doneDisabled} onClick=${onDone}><span>${doneLabel || t('common.done')}</span></button>`}
          </div>
        </header>
        <div class="content sheet-content">${children}</div>
      </div>
    </div>`;
}

// ---------- Диалоги: подтверждение, сообщение, ввод ----------

let dialogState = null;
const dialogListeners = new Set();
const setDialog = (d) => { dialogState = d; dialogListeners.forEach((fn) => fn(d)); };

/** Вопрос «да/нет». Возвращает true при подтверждении. */
export function confirmDialog({ title, message, confirmLabel, destructive }) {
  return new Promise((resolve) => setDialog({ kind: 'confirm', title, message, confirmLabel, destructive, resolve }));
}
export function alertDialog(message, title) {
  return new Promise((resolve) => setDialog({ kind: 'alert', title, message, resolve }));
}
/** Ввод строки. Возвращает текст или null при отмене. */
export function promptDialog({ title, message, placeholder, value = '' }) {
  return new Promise((resolve) => setDialog({ kind: 'prompt', title, message, placeholder, value, resolve }));
}

export function DialogHost() {
  const [d, setD] = useState(dialogState);
  const [text, setText] = useState('');
  useEffect(() => {
    const fn = (x) => { setD(x); setText(x && x.value ? x.value : ''); };
    dialogListeners.add(fn);
    return () => dialogListeners.delete(fn);
  }, []);
  if (!d) return null;
  const close = (result) => { setDialog(null); d.resolve(result); };
  return html`
    <div class="dialog-backdrop">
      <div class="dialog" role="alertdialog" aria-modal="true">
        ${d.title && html`<h2>${d.title}</h2>`}
        ${d.message && html`<p>${d.message}</p>`}
        ${d.kind === 'prompt' && html`<input class="dialog-input" type="text" value=${text} placeholder=${d.placeholder || ''}
          onInput=${(e) => setText(e.target.value)} />`}
        <div class="dialog-actions">
          ${d.kind !== 'alert' && html`<button onClick=${() => close(d.kind === 'prompt' ? null : false)}>${t('common.cancel')}</button>`}
          <button class=${'primary' + (d.destructive ? ' destructive' : '')}
            onClick=${() => close(d.kind === 'prompt' ? text : true)}>
            ${d.confirmLabel || t('common.ok')}
          </button>
        </div>
      </div>
    </div>`;
}

// ---------- Короткое всплывающее сообщение ----------

let toastTimer = null;
const toastListeners = new Set();
export function toast(message) {
  toastListeners.forEach((fn) => fn(message));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastListeners.forEach((fn) => fn(null)), 2600);
}
export function ToastHost() {
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    toastListeners.add(setMsg);
    return () => toastListeners.delete(setMsg);
  }, []);
  return msg ? html`<div class="toast" role="status">${msg}</div>` : null;
}
