// Расписание (неделя / месяц / лента) и список записей на день.
import { html, useState } from '../../vendor/standalone.module.js';
import { useData, getSettings, setSettings, getFlag, setFlag } from '../db.js';
import { t, locale } from '../i18n.js';
import { navigate } from '../router.js';
import { Screen, NavButton, Segmented, Icon, Empty, confirmDialog, toast } from '../ui.js';
import { appointmentsByDay, appointmentsSorted, patientOf, deleteAppointment, restoreAppointment, duplicateAppointment } from '../ops.js';
import { patientName, studyShort } from '../models.js';
import { dayKey, parseDayKey, addDays, addMonths, startOfDay, startOfWeek, startOfMonth, isSameDay, fmtTime } from '../util.js';

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function monthTitle(d) {
  const s = new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric' }).format(d);
  return cap(s.replace(/\s*г\.?$/, ''));
}
const shortDay = (d) => new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short' }).format(d);
const weekdayShort = (d) => new Intl.DateTimeFormat(locale(), { weekday: 'short' }).format(d);
const longDay = (d) => cap(new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long' }).format(d));

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

/** Сколько дней прошло с последней резервной копии (null — копий не было). */
export function backupAgeDays() {
  const last = getSettings().lastBackupAt;
  if (!last) return null;
  return Math.floor((Date.now() - new Date(last).getTime()) / 86400000);
}

function ApptLine({ a }) {
  return html`<button class="agenda-item" onClick=${() => navigate('/a/' + a.id)}>
    <span class="appt-time">${fmtTime(a.date)}</span>
    <span class="row-main">
      <span class="row-label">${patientName(patientOf(a))}</span>
      ${studyShort(a) && html`<span class="row-sub">${studyShort(a)}</span>`}
    </span>
    ${!(a.conclusion || '').trim() && html`<span class="draft-dot" title=${t('agenda.no_conclusion')}></span>`}
  </button>`;
}

export function CalendarScreen() {
  useData();
  const stored = getSettings().calendarMode;
  const mode = stored === 'week' || stored === 'agenda' ? stored : 'month';
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

    // Сводка месяца: исследований, пациентов, рабочих дней.
    let studies = 0;
    let days = 0;
    const patients = new Set();
    for (const d of cells) {
      if (!d) continue;
      const items = groups.get(dayKey(d)) || [];
      if (items.length) days += 1;
      studies += items.length;
      items.forEach((a) => { if (a.patientId) patients.add(a.patientId); });
    }

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
        <div class="stat-cards month-summary">
          <div class="stat-card"><b>${studies}</b><span>${t('stats.studies')}</span></div>
          <div class="stat-card"><b>${patients.size}</b><span>${t('stats.patients')}</span></div>
          <div class="stat-card"><b>${days}</b><span>${t('stats.days')}</span></div>
        </div>
      </div>`;
  } else if (mode === 'week') {
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
  } else {
    // Лента: записи подряд, начиная с выбранной недели, на 4 недели вперёд.
    const start = startOfWeek(anchor);
    const end = addDays(start, 28);
    title = shortDay(start) + ' – ' + shortDay(addDays(end, -1));
    const days = [];
    for (let d = new Date(start); d < end; d = addDays(d, 1)) {
      const items = groups.get(dayKey(d)) || [];
      if (items.length) days.push({ day: new Date(d), items });
    }
    body = days.length === 0
      ? html`<${Empty} icon="calendar" text=${t('agenda.empty')} />`
      : html`<div class="agenda">
          ${days.map(({ day, items }) => html`
            <section key=${dayKey(day)} class="agenda-day">
              <h3 class=${isSameDay(day, today) ? 'today' : ''}>${longDay(day)}</h3>
              <div class="card">${items.map((a) => html`<${ApptLine} key=${a.id} a=${a} />`)}</div>
            </section>`)}
        </div>`;
  }

  const showHint = !hintHidden && isIOS() && !isStandalone();
  const age = backupAgeDays();
  const total = appointmentsSorted().length;
  const needBackup = total > 0 && (age === null || age > 7);

  return html`
    <${Screen} title=${t('schedule')} tabs
      left=${html`<${NavButton} icon="search" label=${t('search.title')} onClick=${() => navigate('/search')} />`}
      right=${html`
        <${NavButton} icon="tomorrow" label=${t('calendar.tomorrow')} onClick=${() => navigate('/new/' + dayKey(addDays(startOfDay(today), 1)))} />
        <${NavButton} icon="plus" label=${t('appointment.new')} onClick=${() => navigate('/new/' + dayKey(today))} />`}>
      ${showHint && html`
        <div class="hint">
          <div><b>${t('install.title')}</b><br />${t('install.short')}</div>
          <button class="link" onClick=${() => { setFlag('installHintHidden', 1); setHintHidden(true); }}>${t('common.ok')}</button>
        </div>`}
      ${needBackup && html`
        <button class="hint warn" onClick=${() => navigate('/settings/backup')}>
          <${Icon} name="warn" />
          <div>${age === null ? t('backup.banner_never') : t('backup.banner_days', age)}</div>
          <${Icon} name="right" size=${16} />
        </button>`}
      <div class="pad">
        <${Segmented} value=${mode} onChange=${(v) => setSettings({ calendarMode: v })}
          options=${[
            { value: 'week', label: t('calendar.week') },
            { value: 'month', label: t('calendar.month') },
            { value: 'agenda', label: t('calendar.agenda') },
          ]} />
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
      message: patientName(patientOf(a)) + ', ' + fmtTime(a.date) + '\n' + t('trash.note'),
      confirmLabel: t('common.delete'),
      destructive: true,
    });
    if (!ok) return;
    await deleteAppointment(a.id);
    toast(t('appointment.deleted'), { label: t('common.undo'), run: () => restoreAppointment(a.id) });
  };
  const duplicate = async (a) => {
    await duplicateAppointment(a.id);
    toast(t('appointment.duplicated'));
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
                  ${!editing && html`<span class="row-chevron"><${Icon} name="right" size=${16} /></span>`}
                </button>
                ${editing && html`<button class="del-btn quiet" onClick=${() => duplicate(a)} aria-label=${t('appointment.duplicate')}><${Icon} name="copy" size=${20} /></button>`}
              </div>`)}
          </div></section>`}
    <//>`;
}
