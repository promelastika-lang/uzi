// Статистика, шаблоны (заключения, патологии, приёмы), настройки, клиника и PDF, резервная копия и корзина, помощь.
import { html, useState, useRef } from '../../vendor/standalone.module.js';
import { useData, put, remove, list, getSettings, setSettings } from '../db.js';
import { t, locale } from '../i18n.js';
import { navigate } from '../router.js';
import {
  Screen, NavButton, Group, Row, TextRow, AreaRow, SelectRow, ToggleRow, Segmented, Sheet, Icon, Empty,
  confirmDialog, alertDialog, choiceDialog, toast,
} from '../ui.js';
import {
  SYSTEMS, STATUS, enabledBlocks, blockResults, buildRefIndex, patientInfo, patientName, studyShort, lowerFirst,
} from '../models.js';
import { makeBackup, parseBackup, restoreBackup, backupStats } from '../exchange.js';
import {
  liveAppointments, trashedAppointments, patientOf, restoreAppointment, purgeTrash, trashDaysLeft, TRASH_DAYS,
  templateSystems, setActiveClinic,
} from '../ops.js';
import { templateGroups, PdfSheet, pdfOptions } from './appointment.js';
import { backupAgeDays } from './calendar.js';
import { buildPeriodDoc, renderPdf } from '../pdf.js';
import {
  uid, addDays, addMonths, startOfWeek, startOfMonth, startOfYear, dayKey, fileDate, fmtDate, fmtTime, fmtDateTime,
  shareFile, downloadBlob, readFileText,
} from '../util.js';

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const errText = (e) => String((e && e.message) || e);

// ---------- Статистика ----------

function periodRange(period, anchor) {
  if (period === 'week') { const start = startOfWeek(anchor); return { start, end: addDays(start, 7) }; }
  if (period === 'month') { const start = startOfMonth(anchor); return { start, end: addMonths(start, 1) }; }
  const start = startOfYear(anchor);
  return { start, end: new Date(start.getFullYear() + 1, 0, 1) };
}

function periodTitle(period, range) {
  const loc = locale();
  if (period === 'week') {
    const f = new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'short' });
    return f.format(range.start) + ' – ' + f.format(addDays(range.end, -1));
  }
  if (period === 'month') {
    return cap(new Intl.DateTimeFormat(loc, { month: 'long', year: 'numeric' }).format(range.start).replace(/\s*г\.?$/, ''));
  }
  return String(range.start.getFullYear());
}

function BarChart({ buckets }) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const W = 320, H = 150, padL = 22, padB = 18, padT = 8;
  const innerW = W - padL - 4, innerH = H - padB - padT;
  const step = innerW / buckets.length;
  const barW = Math.max(2, Math.min(26, step * 0.7));
  const every = buckets.length > 16 ? Math.ceil(buckets.length / 8) : 1;
  const ticks = max <= 4 ? Array.from({ length: max + 1 }, (_, i) => i) : [0, Math.round(max / 2), max];
  return html`
    <svg class="chart" viewBox=${`0 0 ${W} ${H}`} role="img" aria-label=${t('chart.count')}>
      ${ticks.map((v) => {
        const y = padT + innerH - (v / max) * innerH;
        return html`<g key=${'t' + v}>
          <line x1=${padL} y1=${y} x2=${W - 4} y2=${y} class="chart-grid" />
          <text x=${padL - 4} y=${y + 3} text-anchor="end" class="chart-text">${v}</text>
        </g>`;
      })}
      ${buckets.map((b, i) => {
        const h = (b.count / max) * innerH;
        const x = padL + i * step + (step - barW) / 2;
        return html`<g key=${b.key}>
          ${b.count > 0 && html`<rect x=${x} y=${padT + innerH - h} width=${barW} height=${h} rx="2" class="chart-bar" />`}
          ${i % every === 0 && html`<text x=${x + barW / 2} y=${H - 5} text-anchor="middle" class="chart-text">${b.label}</text>`}
        </g>`;
      })}
    </svg>`;
}

const csvCell = (v) => '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"';

export function StatsScreen() {
  const d = useData();
  const [period, setPeriod] = useState('month');
  const [anchor, setAnchor] = useState(new Date());
  const [pdf, setPdf] = useState(null);
  const [busy, setBusy] = useState(false);
  const range = periodRange(period, anchor);
  const items = liveAppointments()
    .filter((a) => { const x = new Date(a.date); return x >= range.start && x < range.end; })
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const title = periodTitle(period, range);
  const refIndex = buildRefIndex(d.references);

  const patients = new Set(items.map((a) => a.patientId).filter(Boolean)).size;
  let systemsTotal = 0;
  const bySystem = new Map();
  const byDoctor = new Map();
  const deviations = new Map();
  for (const a of items) {
    const info = patientInfo(patientOf(a), a.date);
    for (const b of enabledBlocks(a)) {
      systemsTotal += 1;
      bySystem.set(b.system, (bySystem.get(b.system) || 0) + 1);
      for (const section of blockResults(b, refIndex, info)) {
        for (const line of section.lines) {
          if (line.status === 'unknown' || line.status === 'normal') continue;
          const label = `${section.title}: ${lowerFirst(line.title)} — ${STATUS[line.status].title}`;
          deviations.set(label, (deviations.get(label) || 0) + 1);
        }
      }
    }
    const doc = (a.doctorName || '').trim();
    byDoctor.set(doc, (byDoctor.get(doc) || 0) + 1);
  }

  // Столбцы: по дням (неделя, месяц) или по месяцам (год).
  const buckets = [];
  if (period === 'year') {
    const f = new Intl.DateTimeFormat(locale(), { month: 'narrow' });
    for (let m = 0; m < 12; m++) {
      const start = new Date(range.start.getFullYear(), m, 1);
      const count = items.filter((a) => new Date(a.date).getMonth() === m).length;
      buckets.push({ key: 'm' + m, label: f.format(start), count });
    }
  } else {
    const counts = new Map();
    for (const a of items) counts.set(dayKey(a.date), (counts.get(dayKey(a.date)) || 0) + 1);
    const wf = new Intl.DateTimeFormat(locale(), { weekday: 'short' });
    for (let day = new Date(range.start); day < range.end; day = addDays(day, 1)) {
      buckets.push({ key: dayKey(day), label: period === 'week' ? wf.format(day) : String(day.getDate()), count: counts.get(dayKey(day)) || 0 });
    }
  }

  const shift = (n) => setAnchor(period === 'week' ? addDays(anchor, 7 * n) : period === 'month' ? addMonths(anchor, n) : new Date(anchor.getFullYear() + n, anchor.getMonth(), 1));
  const systemRows = SYSTEMS.filter((s) => bySystem.get(s.id)).map((s) => ({ key: s.id, title: t('system.' + s.id), count: bySystem.get(s.id) }));
  const doctorRows = Array.from(byDoctor.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'))
    .map(([name, count]) => ({ key: name || '-', title: name || '—', count }));
  const deviationRows = Array.from(deviations.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru')).slice(0, 5)
    .map(([label, count]) => ({ key: label, title: label, count }));

  const countList = (rows) => {
    if (!rows.length) return html`<div class="row muted">${t('stats.no_data')}</div>`;
    const max = Math.max(...rows.map((r) => r.count));
    return rows.map((r) => html`
      <div key=${r.key} class="row stack">
        <div class="result-top"><span>${r.title}</span><b>${r.count}</b></div>
        <div class="progress"><span style=${'width:' + Math.round((r.count / max) * 100) + '%'}></span></div>
      </div>`);
  };

  const exportCsv = async () => {
    const head = ['Дата', 'Время', 'Пациент', 'Карта', 'Системы', 'Врач', 'Протокол', 'Заключение'];
    const lines = [head.map(csvCell).join(';')];
    for (const a of items) {
      const p = patientOf(a);
      lines.push([fmtDate(a.date), fmtTime(a.date), patientName(p), p ? p.cardNumber : '', studyShort(a), a.doctorName, a.protocolNumber, a.conclusion].map(csvCell).join(';'));
    }
    // BOM в начале — чтобы Excel правильно открыл русский текст.
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' });
    const name = `uzi-statistics-${fileDate(range.start)}.csv`;
    const result = await shareFile(blob, name, name);
    if (result === 'downloaded') toast(t('exchange.export_done'));
  };

  const exportPdf = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const rows = items.map((a) => ({ appt: a, patient: patientOf(a) }));
      const blob = await renderPdf(buildPeriodDoc(title, rows, { studies: items.length, patients, systems: systemsTotal }, pdfOptions()));
      setPdf({ blob, filename: `uzi-report-${fileDate(range.start)}.pdf` });
    } catch (e) {
      alertDialog(errText(e), t('pdf.error'));
    } finally {
      setBusy(false);
    }
  };

  return html`
    <${Screen} title=${t('statistics')} tabs>
      <div class="pad">
        <${Segmented} value=${period} onChange=${setPeriod} options=${[
          { value: 'week', label: t('stats.period.week') },
          { value: 'month', label: t('stats.period.month') },
          { value: 'year', label: t('stats.period.year') },
        ]} />
        <div class="period">
          <button class="icon-btn" onClick=${() => shift(-1)} aria-label="‹"><${Icon} name="left" /></button>
          <button class="period-title" onClick=${() => setAnchor(new Date())}>${title}</button>
          <button class="icon-btn" onClick=${() => shift(1)} aria-label="›"><${Icon} name="right" /></button>
        </div>
        <div class="stat-cards">
          <div class="stat-card"><b>${items.length}</b><span>${t('stats.studies')}</span></div>
          <div class="stat-card"><b>${patients}</b><span>${t('stats.patients')}</span></div>
          <div class="stat-card"><b>${systemsTotal}</b><span>${t('stats.systems')}</span></div>
        </div>
      </div>
      <${Group} title=${period === 'year' ? t('stats.by_month') : t('stats.by_day')}>
        <div class="row chart-row"><${BarChart} buckets=${buckets} /></div>
      <//>
      <${Group} title=${t('stats.deviations')}>${countList(deviationRows)}<//>
      <${Group} title=${t('stats.by_system')}>${countList(systemRows)}<//>
      <${Group} title=${t('stats.by_doctor')}>${countList(doctorRows)}<//>
      <${Group} title=${t('stats.export')}>
        <${Row} label=${busy ? t('pdf.building') : t('stats.export_pdf')} icon="doc" accent onClick=${exportPdf} />
        <${Row} label=${t('stats.export_csv')} icon="share" accent onClick=${exportCsv} />
      <//>
      ${pdf && html`<${PdfSheet} pdf=${pdf} email="" onClose=${() => setPdf(null)} />`}
    <//>`;
}

// ---------- Шаблоны: заключения, патологии, приёмы ----------

export function TemplatesScreen() {
  const d = useData();
  const [kind, setKind] = useState('templates');
  const [editing, setEditing] = useState(null);
  const isText = kind !== 'apptTemplates';
  const items = list(kind).sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  const groups = isText ? templateGroups(items, []) : [];

  const removeAppt = async (x) => {
    const ok = await confirmDialog({ title: t('templates.delete_confirm'), message: x.title, confirmLabel: t('common.delete'), destructive: true });
    if (ok) await remove('apptTemplates', x.id);
  };

  return html`
    <${Screen} title=${t('templates')} tabs
      right=${isText && html`<${NavButton} icon="plus" label=${t('templates.add')} onClick=${() => setEditing({ id: null, title: '', text: '', system: '' })} />`}>
      <div class="pad">
        <${Segmented} value=${kind} onChange=${setKind} options=${[
          { value: 'templates', label: t('templates.kind.conclusions') },
          { value: 'pathologies', label: t('templates.kind.pathologies') },
          { value: 'apptTemplates', label: t('templates.kind.appointments') },
        ]} />
      </div>
      ${items.length === 0 && html`<${Empty} icon="text" text=${isText ? t('templates.empty') : t('appt_tpl.empty')} />`}
      ${isText && groups.map((g) => html`
        <${Group} key=${g.id} title=${g.title}>
          ${g.items.map((x) => html`<${Row} key=${x.id} label=${x.title} sub=${x.text} chevron onClick=${() => setEditing({ ...x })} />`)}
        <//>`)}
      ${!isText && items.length > 0 && html`
        <${Group} footer=${t('appt_tpl.manage_hint')}>
          ${items.map((x) => html`
            <div key=${x.id} class="row appt-row">
              <div class="appt-main static">
                <span class="row-main">
                  <span class="row-label">${x.title}</span>
                  <span class="row-sub">${[templateSystems(x), (x.conclusion || '').slice(0, 90)].filter(Boolean).join('\n')}</span>
                </span>
              </div>
              <button class="del-btn quiet" onClick=${() => removeAppt(x)} aria-label=${t('common.delete')}><${Icon} name="trash" size=${18} /></button>
            </div>`)}
        <//>`}
      ${editing && html`<${TemplateSheet} store=${kind} template=${editing} onClose=${() => setEditing(null)} />`}
    <//>`;
}

function TemplateSheet({ store, template, onClose }) {
  const [form, setForm] = useState(template);
  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));
  const canSave = form.title.trim() !== '' && form.text.trim() !== '';

  const save = async () => {
    if (!canSave) return;
    await put(store, {
      id: form.id || uid(),
      title: form.title.trim(),
      text: form.text.trim(),
      system: form.system || '',
      createdAt: form.createdAt || new Date().toISOString(),
    });
    toast(t('common.saved'));
    onClose();
  };
  const del = async () => {
    const ok = await confirmDialog({ title: t('templates.delete_confirm'), message: form.title, confirmLabel: t('common.delete'), destructive: true });
    if (!ok) return;
    await remove(store, form.id);
    onClose();
  };

  return html`
    <${Sheet} title=${form.id ? t('templates.edit') : t('templates.add')} onClose=${onClose}
      onDone=${save} doneLabel=${t('common.save')} doneDisabled=${!canSave}>
      <${Group}>
        <${TextRow} label=${t('templates.title')} value=${form.title} onInput=${(v) => set({ title: v })} />
        <${SelectRow} label=${t('templates.system')} value=${form.system || ''} onChange=${(v) => set({ system: v })}
          options=${[{ value: '', label: t('templates.general') }, ...SYSTEMS.map((s) => ({ value: s.id, label: t('system.' + s.id) }))]} />
      <//>
      <${Group} title=${t('templates.text')}>
        <${AreaRow} value=${form.text} minRows=${5} onInput=${(v) => set({ text: v })} />
      <//>
      ${form.id && html`<${Group}><${Row} label=${t('templates.delete')} icon="trash" destructive onClick=${del} /><//>`}
    <//>`;
}

// ---------- Настройки ----------

export function SettingsScreen() {
  useData();
  const s = getSettings();
  const standalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  const age = backupAgeDays();
  const trash = trashedAppointments().length;

  return html`
    <${Screen} title=${t('settings')} tabs>
      <${Group} title=${t('settings.appearance')}>
        <${SelectRow} label=${t('settings.language')} value=${s.lang} onChange=${(v) => setSettings({ lang: v })}
          options=${[{ value: 'ru', label: 'Русский' }, { value: 'en', label: 'English' }]} />
        <${SelectRow} label=${t('settings.theme')} value=${s.theme} onChange=${(v) => setSettings({ theme: v })}
          options=${[
            { value: 'system', label: t('theme.system') },
            { value: 'light', label: t('theme.light') },
            { value: 'dark', label: t('theme.dark') },
          ]} />
      <//>

      <${Group}>
        <${Row} label=${t('clinic.title')} icon="building" chevron onClick=${() => navigate('/settings/clinic')} />
        <${Row} label=${t('backup.title')} icon="download" chevron
          sub=${age === null ? t('backup.never_long') : t('backup.age', age)}
          value=${trash > 0 ? t('trash.count', trash) : null}
          onClick=${() => navigate('/settings/backup')} />
        <${Row} label=${t('help.title')} icon="help" chevron onClick=${() => navigate('/help')} />
      <//>

      <${Group} title=${t('settings.defaults')} footer=${t('settings.defaults_footer')}>
        <${TextRow} label=${t('conclusion.doctor')} value=${s.doctorName} onInput=${(v) => setSettings({ doctorName: v })} autocapitalize="words" />
        <${TextRow} label=${t('technical.us_system')} value=${s.usSystemName} onInput=${(v) => setSettings({ usSystemName: v })} />
      <//>

      ${!standalone && html`
        <${Group} title=${t('install.title')}>
          <div class="row stack"><span class="row-text">${t('install.steps')}</span></div>
        <//>`}

      <${Group} title=${t('settings.about')}>
        <${Row} label=${t('settings.version')} value=${window.UZI_VERSION || '—'} />
        <div class="row stack"><span class="row-text small muted">${t('settings.disclaimer')}</span></div>
      <//>
    <//>`;
}

// ---------- Клиника и PDF ----------

/** Картинку логотипа уменьшаем до 256 px и сохраняем как PNG — так её понимает PDF. */
function readLogo(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 256;
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * k));
      canvas.height = Math.max(1, Math.round(img.height * k));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось прочитать картинку.')); };
    img.src = url;
  });
}

export function ClinicScreen() {
  const d = useData();
  const s = getSettings();
  const [editing, setEditing] = useState(null);
  const clinics = Array.from(d.clinics.values()).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'));
  const scale = Number(s.pdfFontScale) || 1;

  return html`
    <${Screen} title=${t('clinic.title')} backTo="/settings"
      right=${html`<${NavButton} icon="plus" label=${t('clinic.add')}
        onClick=${() => setEditing({ id: null, name: '', address: '', phone: '', email: '', logo: '', isActive: clinics.length === 0 })} />`}>
      <${Group} title=${t('clinic.profiles')} footer=${clinics.length ? t('clinic.profiles_hint') : t('clinic.empty_hint')}>
        ${clinics.length === 0 && html`<div class="row muted">${t('clinic.empty')}</div>`}
        ${clinics.map((c) => html`
          <div key=${c.id} class="row appt-row">
            <button class="appt-main" onClick=${() => setActiveClinic(c.isActive ? null : c.id)}>
              <span class=${'check' + (c.isActive ? ' on' : '')}>${c.isActive && html`<${Icon} name="check" size=${16} />`}</span>
              <span class="row-main">
                <span class="row-label">${c.name || '—'}</span>
                ${c.address && html`<span class="row-sub">${c.address}</span>`}
              </span>
            </button>
            <button class="del-btn quiet" onClick=${() => setEditing({ ...c })} aria-label=${t('common.edit')}><${Icon} name="pencil" size=${18} /></button>
          </div>`)}
      <//>

      <${Group} title=${t('clinic.pdf')} footer=${t('clinic.pdf_hint')}>
        <${ToggleRow} label=${t('clinic.pdf_logo')} checked=${s.pdfLogo !== false} onChange=${(v) => setSettings({ pdfLogo: v })} />
        <${ToggleRow} label=${t('clinic.pdf_sources')} checked=${s.pdfSources !== false} onChange=${(v) => setSettings({ pdfSources: v })} />
        <${ToggleRow} label=${t('clinic.pdf_signature')} checked=${s.pdfSignature !== false} onChange=${(v) => setSettings({ pdfSignature: v })} />
        <label class="row stack">
          <div class="result-top"><span>${t('clinic.pdf_font')}</span><b>${Math.round(scale * 100)}%</b></div>
          <input class="range" type="range" min="0.85" max="1.2" step="0.05" value=${scale}
            onInput=${(e) => setSettings({ pdfFontScale: Number(e.target.value) })} />
        </label>
      <//>
      ${editing && html`<${ClinicSheet} clinic=${editing} onClose=${() => setEditing(null)} />`}
    <//>`;
}

function ClinicSheet({ clinic, onClose }) {
  const [form, setForm] = useState(clinic);
  const fileInput = useRef(null);
  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));
  const canSave = form.name.trim() !== '';

  const save = async () => {
    if (!canSave) return;
    const id = form.id || uid();
    await put('clinics', {
      id, name: form.name.trim(), address: form.address.trim(), phone: form.phone.trim(), email: form.email.trim(),
      logo: form.logo || '', isActive: !!form.isActive,
    });
    if (form.isActive) await setActiveClinic(id);
    toast(t('common.saved'));
    onClose();
  };
  const del = async () => {
    const ok = await confirmDialog({ title: t('clinic.delete_confirm'), message: form.name, confirmLabel: t('common.delete'), destructive: true });
    if (!ok) return;
    await remove('clinics', form.id);
    onClose();
  };
  const onFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try { set({ logo: await readLogo(file) }); } catch (err) { alertDialog(errText(err), t('common.error')); }
  };

  return html`
    <${Sheet} title=${form.id ? t('clinic.edit') : t('clinic.add')} onClose=${onClose}
      onDone=${save} doneLabel=${t('common.save')} doneDisabled=${!canSave}>
      <${Group}>
        <${AreaRow} label=${t('settings.org_name')} value=${form.name} minRows=${1} onInput=${(v) => set({ name: v })} />
        <${AreaRow} label=${t('settings.org_address')} value=${form.address} minRows=${1} onInput=${(v) => set({ address: v })} />
        <${TextRow} label=${t('clinic.phone')} value=${form.phone} type="tel" inputmode="tel" onInput=${(v) => set({ phone: v })} />
        <${TextRow} label=${t('patient.email')} value=${form.email} type="email" inputmode="email" autocapitalize="off" onInput=${(v) => set({ email: v })} />
        <${ToggleRow} label=${t('clinic.active')} checked=${!!form.isActive} onChange=${(v) => set({ isActive: v })} />
      <//>
      <${Group} title=${t('clinic.logo')}>
        ${form.logo && html`<div class="row"><img class="logo-preview" src=${form.logo} alt=${t('clinic.logo')} /></div>`}
        <${Row} label=${form.logo ? t('clinic.logo_change') : t('clinic.logo_pick')} icon="plus" accent onClick=${() => fileInput.current && fileInput.current.click()} />
        ${form.logo && html`<${Row} label=${t('clinic.logo_remove')} icon="trash" destructive onClick=${() => set({ logo: '' })} />`}
      <//>
      <input ref=${fileInput} type="file" accept="image/*" class="hidden-input" onChange=${onFile} />
      ${form.id && html`<${Group}><${Row} label=${t('clinic.delete')} icon="trash" destructive onClick=${del} /><//>`}
    <//>`;
}

// ---------- Резервная копия и корзина ----------

export function BackupScreen() {
  const d = useData();
  const s = getSettings();
  const fileInput = useRef(null);
  const backupName = 'uzi-backup-' + fileDate() + '.json';
  const makeBlob = () => new Blob([makeBackup()], { type: 'application/json' });
  const trash = trashedAppointments();
  const expired = trash.filter((a) => trashDaysLeft(a) === 0).length;

  const shareBackup = async () => {
    const result = await shareFile(makeBlob(), backupName, backupName);
    if (result !== 'cancelled') setSettings({ lastBackupAt: new Date().toISOString() });
    if (result === 'downloaded') toast(t('backup.saved'));
  };
  const downloadBackup = () => {
    downloadBlob(makeBlob(), backupName);
    setSettings({ lastBackupAt: new Date().toISOString() });
    toast(t('backup.saved'));
  };

  const onFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const obj = parseBackup(await readFileText(file));
      const st = backupStats(obj);
      const strategy = await choiceDialog({
        title: t('backup.restore_confirm'),
        message: t('backup.restore_message', st.appointments.total, st.appointments.fresh, st.patients.total, st.patients.fresh),
        options: [
          { label: t('backup.strategy_merge'), value: 'merge' },
          { label: t('backup.strategy_skip'), value: 'skipExisting' },
          { label: t('backup.strategy_replace'), value: 'replaceAll', destructive: true },
        ],
      });
      if (!strategy) return;
      if (strategy === 'replaceAll') {
        const ok = await confirmDialog({ title: t('backup.replace_confirm'), message: t('backup.restore_warning'), confirmLabel: t('backup.strategy_replace'), destructive: true });
        if (!ok) return;
      }
      await restoreBackup(obj, strategy);
      toast(t('backup.restored'));
    } catch (err) {
      alertDialog(errText(err), t('common.error'));
    }
  };

  const purge = async (days) => {
    const ok = await confirmDialog({
      title: days ? t('trash.purge_old_confirm') : t('trash.purge_all_confirm'),
      message: t('trash.purge_warning'), confirmLabel: t('common.delete'), destructive: true,
    });
    if (!ok) return;
    const n = await purgeTrash(days);
    toast(t('trash.purged', n));
  };

  return html`
    <${Screen} title=${t('backup.title')} backTo="/settings">
      <${Group} title=${t('backup.export')} footer=${t('backup.footer')}>
        <${Row} label=${t('backup.records')} value=${t('backup.records_value', liveAppointments().length, d.patients.size)} />
        <${Row} label=${t('backup.last')} value=${s.lastBackupAt ? fmtDateTime(s.lastBackupAt) : t('backup.never')} />
        <${Row} label=${t('backup.share')} icon="share" accent onClick=${shareBackup} />
        <${Row} label=${t('backup.download')} icon="download" accent onClick=${downloadBackup} />
      <//>
      <${Group} title=${t('backup.import')} footer=${t('backup.import_footer')}>
        <${Row} label=${t('backup.restore')} icon="refresh" accent onClick=${() => fileInput.current && fileInput.current.click()} />
      <//>
      <input ref=${fileInput} type="file" accept=".json,application/json" class="hidden-input" onChange=${onFile} />

      <${Group} title=${t('trash.title')} footer=${t('trash.footer', TRASH_DAYS)}>
        ${trash.length === 0 && html`<div class="row muted">${t('trash.empty')}</div>`}
        ${trash.map((a) => html`
          <div key=${a.id} class="row appt-row">
            <div class="appt-main static">
              <span class="row-main">
                <span class="row-label">${patientName(patientOf(a))}</span>
                <span class="row-sub">${fmtDateTime(a.date)} · ${t('trash.days_left', trashDaysLeft(a))}</span>
              </span>
            </div>
            <button class="link pad-link" onClick=${async () => { await restoreAppointment(a.id); toast(t('trash.restored')); }}>${t('trash.restore')}</button>
          </div>`)}
        ${expired > 0 && html`<${Row} label=${t('trash.purge_old', expired)} icon="trash" destructive onClick=${() => purge(TRASH_DAYS)} />`}
        ${trash.length > 0 && html`<${Row} label=${t('trash.purge_all')} icon="trash" destructive onClick=${() => purge(0)} />`}
      <//>
    <//>`;
}

// ---------- Помощь ----------

const HELP_SECTIONS = ['protocol', 'speed', 'pdf', 'norms', 'backup', 'transfer', 'limits'];

export function HelpScreen() {
  useData();
  return html`
    <${Screen} title=${t('help.title')} backTo="/settings">
      ${HELP_SECTIONS.map((id) => html`
        <${Group} key=${id} title=${t('help.' + id + '.title')}>
          <div class="row stack"><span class="row-text">${t('help.' + id + '.text')}</span></div>
        <//>`)}
    <//>`;
}

// ---------- Знакомство при первом запуске ----------

const ONBOARDING = [
  { icon: 'calendar', key: 'welcome' },
  { icon: 'book', key: 'norms' },
  { icon: 'doc', key: 'pdf' },
  { icon: 'download', key: 'backup' },
];

export function Onboarding() {
  const [step, setStep] = useState(0);
  const finish = () => setSettings({ onboardingDone: true });
  const slide = ONBOARDING[step];
  const last = step === ONBOARDING.length - 1;
  return html`
    <div class="onboarding" role="dialog" aria-modal="true">
      <button class="link onboarding-skip" onClick=${finish}>${t('onboarding.skip')}</button>
      <div class="onboarding-body">
        <div class="onboarding-icon"><${Icon} name=${slide.icon} size=${56} /></div>
        <h2>${t('onboarding.' + slide.key + '.title')}</h2>
        <p>${t('onboarding.' + slide.key + '.text')}</p>
      </div>
      <div class="onboarding-dots">${ONBOARDING.map((x, i) => html`<span key=${x.key} class=${i === step ? 'on' : ''}></span>`)}</div>
      <button class="big-btn" onClick=${() => (last ? finish() : setStep(step + 1))}>${last ? t('onboarding.start') : t('onboarding.next')}</button>
    </div>`;
}
