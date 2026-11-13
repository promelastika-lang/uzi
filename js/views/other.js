// Статистика, шаблоны заключений, настройки и резервная копия.
import { html, useState, useRef } from '../../vendor/standalone.module.js';
import { useData, put, remove, list, getSettings, setSettings } from '../db.js';
import { t, locale } from '../i18n.js';
import {
  Screen, NavButton, Group, Row, TextRow, AreaRow, SelectRow, Segmented, Sheet, Icon, Empty,
  confirmDialog, alertDialog, toast,
} from '../ui.js';
import { SYSTEMS, enabledBlocks } from '../models.js';
import { makeBackup, parseBackup, restoreBackup, backupStats } from '../exchange.js';
import { templateGroups } from './appointment.js';
import {
  uid, addDays, addMonths, startOfWeek, startOfMonth, startOfYear, dayKey, fileDate, fmtDateTime,
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

export function StatsScreen() {
  const d = useData();
  const [period, setPeriod] = useState('month');
  const [anchor, setAnchor] = useState(new Date());
  const range = periodRange(period, anchor);
  const items = list('appointments').filter((a) => { const x = new Date(a.date); return x >= range.start && x < range.end; });

  const patients = new Set(items.map((a) => a.patientId).filter(Boolean)).size;
  let systemsTotal = 0;
  const bySystem = new Map();
  const byDoctor = new Map();
  for (const a of items) {
    for (const b of enabledBlocks(a)) {
      systemsTotal += 1;
      bySystem.set(b.system, (bySystem.get(b.system) || 0) + 1);
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

  const countList = (rows) => {
    if (!rows.length) return html`<div class="row muted">${t('stats.no_data')}</div>`;
    const max = Math.max(...rows.map((r) => r.count));
    return rows.map((r) => html`
      <div key=${r.key} class="row stack">
        <div class="result-top"><span>${r.title}</span><b>${r.count}</b></div>
        <div class="progress"><span style=${'width:' + Math.round((r.count / max) * 100) + '%'}></span></div>
      </div>`);
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
          <button class="period-title" onClick=${() => setAnchor(new Date())}>${periodTitle(period, range)}</button>
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
      <${Group} title=${t('stats.by_system')}>${countList(systemRows)}<//>
      <${Group} title=${t('stats.by_doctor')}>${countList(doctorRows)}<//>
    <//>`;
}

// ---------- Шаблоны заключений ----------

export function TemplatesScreen() {
  useData();
  const [editing, setEditing] = useState(null);
  const templates = list('templates').sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  const groups = templateGroups(templates, []);

  return html`
    <${Screen} title=${t('templates')} tabs
      right=${html`<${NavButton} icon="plus" label=${t('templates.add')} onClick=${() => setEditing({ id: null, title: '', text: '', system: '' })} />`}>
      ${groups.length === 0 && html`<${Empty} icon="text" text=${t('templates.empty')} />`}
      ${groups.map((g) => html`
        <${Group} key=${g.id} title=${g.title}>
          ${g.items.map((x) => html`<${Row} key=${x.id} label=${x.title} sub=${x.text} chevron onClick=${() => setEditing({ ...x })} />`)}
        <//>`)}
      ${editing && html`<${TemplateSheet} template=${editing} onClose=${() => setEditing(null)} />`}
    <//>`;
}

function TemplateSheet({ template, onClose }) {
  const [form, setForm] = useState(template);
  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));
  const canSave = form.title.trim() !== '' && form.text.trim() !== '';

  const save = async () => {
    if (!canSave) return;
    await put('templates', {
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
    await remove('templates', form.id);
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
  const d = useData();
  const s = getSettings();
  const fileInput = useRef(null);
  const backupName = 'uzi-backup-' + fileDate() + '.json';
  const makeBlob = () => new Blob([makeBackup()], { type: 'application/json' });

  const shareBackup = async () => {
    const result = await shareFile(makeBlob(), backupName, backupName);
    if (result !== 'cancelled') { setSettings({ lastBackupAt: new Date().toISOString() }); }
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
      const ok = await confirmDialog({
        title: t('backup.restore_confirm'),
        message: t('backup.restore_message', st.appointments, st.patients, st.references) + '\n\n' + t('backup.restore_warning'),
        confirmLabel: t('backup.restore'),
        destructive: true,
      });
      if (!ok) return;
      await restoreBackup(obj);
      toast(t('backup.restored'));
    } catch (err) {
      alertDialog(errText(err), t('common.error'));
    }
  };

  const standalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

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

      <${Group} title=${t('settings.organization')} footer=${t('settings.organization_footer')}>
        <${AreaRow} label=${t('settings.org_name')} value=${s.orgName} minRows=${1} onInput=${(v) => setSettings({ orgName: v })} />
        <${AreaRow} label=${t('settings.org_address')} value=${s.orgAddress} minRows=${1} onInput=${(v) => setSettings({ orgAddress: v })} />
      <//>

      <${Group} title=${t('settings.defaults')} footer=${t('settings.defaults_footer')}>
        <${TextRow} label=${t('conclusion.doctor')} value=${s.doctorName} onInput=${(v) => setSettings({ doctorName: v })} autocapitalize="words" />
        <${TextRow} label=${t('technical.us_system')} value=${s.usSystemName} onInput=${(v) => setSettings({ usSystemName: v })} />
        <${TextRow} label=${t('technical.probe')} value=${s.probeType} onInput=${(v) => setSettings({ probeType: v })} />
      <//>

      <${Group} title=${t('backup.title')} footer=${t('backup.footer')}>
        <${Row} label=${t('backup.records')} value=${t('backup.records_value', d.appointments.size, d.patients.size)} />
        <${Row} label=${t('backup.last')} value=${s.lastBackupAt ? fmtDateTime(s.lastBackupAt) : t('backup.never')} />
        <${Row} label=${t('backup.share')} icon="share" accent onClick=${shareBackup} />
        <${Row} label=${t('backup.download')} icon="download" accent onClick=${downloadBackup} />
        <${Row} label=${t('backup.restore')} icon="refresh" destructive onClick=${() => fileInput.current && fileInput.current.click()} />
      <//>
      <input ref=${fileInput} type="file" accept=".json,application/json" class="hidden-input" onChange=${onFile} />

      ${!standalone && html`
        <${Group} title=${t('install.title')}>
          <div class="row stack"><span class="row-text">${t('install.steps')}</span></div>
        <//>`}

      <${Group} title=${t('settings.about')}>
        <${Row} label=${t('settings.version')} value=${window.UZI_VERSION || '1.0'} />
        <div class="row stack"><span class="row-text small muted">${t('settings.disclaimer')}</span></div>
      <//>
    <//>`;
}
