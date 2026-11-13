// Расписание (неделя / месяц) и список записей на день.
import { html, useState } from '../../vendor/standalone.module.js';
import { useData, getSettings, setSettings, getFlag, setFlag } from '../db.js';
import { t, locale } from '../i18n.js';
import { navigate } from '../router.js';
import { Screen, NavButton, Segmented, Icon, Empty, confirmDialog, toast } from '../ui.js';
import { appointmentsByDay, patientOf, deleteAppointment } from '../ops.js';
import { patientName, studyShort } from '../models.js';
import { dayKey, parseDayKey, addDays, addMonths, startOfWeek, startOfMonth, isSameDay, fmtTime } from '../util.js';

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function monthTitle(d) {
  const s = new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric' }).format(d);
  return cap(s.replace(/\s*г\.?$/, ''));
}
function shortDay(d) {
  return new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short' }).format(d);
}
function weekdayShort(d) {
  return new Intl.DateTimeFormat(locale(), { weekday: 'short' }).format(d);
}

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

export function CalendarScreen() {
  useData();
  const mode = getSettings().calendarMode === 'week' ? 'week' : 'month';
  const [anchor, setAnchor] = useState(new Date());
  const [hintHidden, setHintHidden] = useState(!!getFlag('installHintHidden'));
  const groups = appointmentsByDay();
  const today = new Date();

  const open = (day) => {
    const key = dayKey(day);
    if ((groups.get(key) || []).length) navigate('/day/' + key);
    else navigate('/new/' + key);
  };
  const shift = (n) => setAnchor(mode === 'month' ? addMonths(anchor, n) : addDays(anchor, 7 * n));

  let title;
  let body;
  if (mode === 'month') {
    const first = startOfMonth(anchor);
    const gridStart = startOfWeek(first);
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const leading = Math.round((first - gridStart) / 86400000);
    const cells = [];
    for (let i = 0; i < leading; i++) cells.push(null);
    for (let i = 0; i < daysInMonth; i++) cells.push(new Date(first.getFullYear(), first.getMonth(), i + 1));
    const weekdays = Array.from({ length: 7 }, (_, i) => weekdayShort(addDays(gridStart, i)));
    title = monthTitle(anchor);
    body = html`
      <div class="month">
        <div class="weekdays">${weekdays.map((w) => html`<span key=${w}>${w}</span>`)}</div>
        <div class="month-grid">
          ${cells.map((d, i) => {
            if (!d) return html`<span key=${'e' + i} class="day-cell empty-cell"></span>`;
            const count = (groups.get(dayKey(d)) || []).length;
            return html`<button key=${dayKey(d)} class=${'day-cell' + (isSameDay(d, today) ? ' today' : '')} onClick=${() => open(d)}>
              <span class="day-num">${d.getDate()}</span>
              ${count > 0 ? html`<span class="badge">${count}</span>` : html`<span class="badge ghost"> </span>`}
            </button>`;
          })}
        </div>
      </div>`;
  } else {
    const start = startOfWeek(anchor);
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    title = shortDay(days[0]) + ' – ' + shortDay(days[6]);
    body = html`
      <div class="week">
        ${days.map((d) => {
          const items = groups.get(dayKey(d)) || [];
          return html`<button key=${dayKey(d)} class=${'week-row' + (isSameDay(d, today) ? ' today' : '')} onClick=${() => open(d)}>
            <span class="week-date"><small>${weekdayShort(d)}</small><b>${d.getDate()}</b></span>
            <span class="week-items">
              ${items.length === 0 && html`<span class="muted">${t('calendar.no_appointments')}</span>`}
              ${items.slice(0, 3).map((a) => html`<span key=${a.id} class="week-item">${fmtTime(a.date)}  ${patientName(patientOf(a))}</span>`)}
              ${items.length > 3 && html`<span class="muted small">+${items.length - 3}</span>`}
            </span>
            ${items.length > 0 && html`<span class="badge">${items.length}</span>`}
          </button>`;
        })}
      </div>`;
  }

  const showHint = !hintHidden && isIOS() && !isStandalone();

  return html`
    <${Screen} title=${t('schedule')} tabs
      right=${html`<${NavButton} icon="plus" label=${t('appointment.new')} onClick=${() => navigate('/new/' + dayKey(today))} />`}>
      ${showHint && html`
        <div class="hint">
          <div><b>${t('install.title')}</b><br />${t('install.short')}</div>
          <button class="link" onClick=${() => { setFlag('installHintHidden', 1); setHintHidden(true); }}>${t('common.ok')}</button>
        </div>`}
      <div class="pad">
        <${Segmented} value=${mode} onChange=${(v) => setSettings({ calendarMode: v })}
          options=${[{ value: 'week', label: t('calendar.week') }, { value: 'month', label: t('calendar.month') }]} />
        <div class="period">
          <button class="icon-btn" onClick=${() => shift(-1)} aria-label="‹"><${Icon} name="left" /></button>
          <button class="period-title" onClick=${() => setAnchor(new Date())}>${title}</button>
          <button class="icon-btn" onClick=${() => shift(1)} aria-label="›"><${Icon} name="right" /></button>
        </div>
        ${body}
      </div>
    <//>`;
}

export function DayScreen({ dayKeyValue }) {
  useData();
  const [editing, setEditing] = useState(false);
  const day = parseDayKey(dayKeyValue) || new Date();
  const items = appointmentsByDay().get(dayKey(day)) || [];
  const title = cap(new Intl.DateTimeFormat(locale(), { weekday: 'short', day: 'numeric', month: 'long' }).format(day));

  const del = async (a) => {
    const ok = await confirmDialog({
      title: t('appointment.delete_confirm'),
      message: patientName(patientOf(a)) + ', ' + fmtTime(a.date),
      confirmLabel: t('common.delete'),
      destructive: true,
    });
    if (!ok) return;
    await deleteAppointment(a.id);
    toast(t('appointment.deleted'));
  };

  return html`
    <${Screen} title=${title} backTo="/"
      right=${html`
        ${items.length > 0 && html`<${NavButton} label=${editing ? t('common.done') : t('common.edit')} strong=${editing} onClick=${() => setEditing(!editing)} />`}
        <${NavButton} icon="plus" label=${t('appointment.new')} onClick=${() => navigate('/new/' + dayKey(day))} />`}>
      ${items.length === 0
        ? html`<${Empty} icon="calendar" text=${t('day.empty')} />`
        : html`<section class="group"><div class="card">
            ${items.map((a) => html`
              <div key=${a.id} class="row appt-row">
                ${editing && html`<button class="del-btn" onClick=${() => del(a)} aria-label=${t('common.delete')}><${Icon} name="trash" size=${20} /></button>`}
                <button class="appt-main" onClick=${() => navigate('/a/' + a.id)}>
                  <span class="appt-time">${fmtTime(a.date)}</span>
                  <span class="row-main">
                    <span class="row-label strong">${patientName(patientOf(a))}</span>
                    ${studyShort(a) && html`<span class="row-sub">${studyShort(a)}</span>`}
                    ${a.protocolNumber && html`<span class="row-sub">№ ${a.protocolNumber}</span>`}
                  </span>
                  <span class="row-chevron"><${Icon} name="right" size=${16} /></span>
                </button>
              </div>`)}
          </div></section>`}
    <//>`;
}
