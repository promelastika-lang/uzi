// История пациента, динамика измерений, сравнение двух исследований, общий поиск.
import { html, useState } from '../../vendor/standalone.module.js';
import { useData } from '../db.js';
import { t } from '../i18n.js';
import { navigate } from '../router.js';
import { Screen, Group, Row, Empty, SearchBox, alertDialog } from '../ui.js';
import {
  SYSTEMS, STATUS, FIELD_INDEX, systemById, normalizeBlocks, hasContent, fieldNumber, fieldLabel, evaluate, rangeText, hasRange,
  pickReference, buildRefIndex, patientInfo, patientName, birthText, studyShort, bmi, translit,
} from '../models.js';
import { patientStudies, patientOf, recentPatients, searchAppointments, lastBlockFor } from '../ops.js';
import { fmtNum, fmtDate, fmtDateTime, fileDate } from '../util.js';
import { buildHistoryDoc, renderPdf } from '../pdf.js';
import { BlockResults, PdfSheet, pdfOptions } from './appointment.js';

const errText = (e) => String((e && e.message) || e);

/** Все измерения пациента по параметрам: «система:ключ» → [{ date, value, apptId }], от старых к новым. */
function collectSeries(studies) {
  const series = new Map();
  for (const a of studies.slice().reverse()) {
    for (const block of normalizeBlocks(a.blocks)) {
      if (!block.enabled) continue;
      for (const [id, entry] of FIELD_INDEX) {
        if (entry.system !== block.system) continue;
        const v = fieldNumber(block, entry.field);
        if (v === null) continue;
        if (!series.has(id)) series.set(id, []);
        series.get(id).push({ date: a.date, value: v, apptId: a.id });
      }
    }
  }
  return series;
}

// ---------- История пациента ----------

export function PatientHistoryScreen({ id }) {
  const d = useData();
  const patient = d.patients.get(id);
  const [busy, setBusy] = useState(false);
  const [pdf, setPdf] = useState(null);

  if (!patient) {
    return html`<${Screen} title=${t('history.title')} backTo="/"><${Empty} icon="person" text=${t('patient.none')} /><//>`;
  }
  const studies = patientStudies(id);
  const refIndex = buildRefIndex(d.references);
  const infoNow = patientInfo(patient, new Date());
  const massIndex = bmi(patient.height, patient.weight);
  const trendCount = Array.from(collectSeries(studies).values()).filter((s) => s.length >= 2).length;

  const makePdf = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const blob = await renderPdf(buildHistoryDoc(patient, studies, d.references, pdfOptions()));
      setPdf({ blob, filename: `History_${translit(patient.surname) || 'patient'}_${fileDate()}.pdf` });
    } catch (e) {
      alertDialog(errText(e), t('pdf.error'));
    } finally {
      setBusy(false);
    }
  };

  return html`
    <${Screen} title=${patientName(patient)} backTo="/">
      <${Group} title=${t('section.patient')}>
        <${Row} label=${t('patient.birth_date')} value=${birthText(patient) + (infoNow.age !== null ? ' (' + t('patient.age', infoNow.age) + ')' : '')} />
        <${Row} label=${t('patient.gender')} value=${patient.gender || '—'} />
        <${Row} label=${t('patient.card_number')} value=${patient.cardNumber || '—'} />
        ${(patient.height || patient.weight) && html`
          <${Row} label=${t('patient.height_weight')}
            value=${[patient.height && patient.height + ' см', patient.weight && fmtNum(patient.weight) + ' кг', massIndex !== null && t('patient.bmi') + ' ' + fmtNum(massIndex)].filter(Boolean).join(' · ')} />`}
        <${Row} label=${t('history.count')} value=${String(studies.length)} />
      <//>

      <${Group}>
        <${Row} label=${t('trend.title')} sub=${trendCount ? null : t('trend.need_two')} icon="chart" accent chevron
          onClick=${() => navigate('/patient/' + id + '/trend')} />
        <${Row} label=${t('compare.title')} sub=${studies.length >= 2 ? null : t('compare.need_two')} icon="compare" accent chevron
          onClick=${() => navigate('/patient/' + id + '/compare')} />
        <${Row} label=${busy ? t('pdf.building') : t('history.pdf')} icon="doc" accent chevron onClick=${makePdf} />
      <//>

      <${Group} title=${t('history.studies')}>
        ${studies.length === 0 && html`<div class="row muted">${t('history.empty')}</div>`}
        ${studies.map((a) => html`<${Row} key=${a.id} label=${fmtDateTime(a.date)}
          sub=${[studyShort(a), (a.conclusion || '').slice(0, 100)].filter(Boolean).join('\n')} chevron
          onClick=${() => navigate('/a/' + a.id)} />`)}
      <//>

      ${SYSTEMS.map((s) => {
        const last = lastBlockFor(id, s.id);
        if (!last) return null;
        return html`
          <div key=${s.id}>
            <p class="summary-date">${t('history.latest', fmtDate(last.appointment.date))}</p>
            <${BlockResults} block=${last.block} refIndex=${refIndex} info=${patientInfo(patient, last.appointment.date)} />
          </div>`;
      })}

      ${pdf && html`<${PdfSheet} pdf=${pdf} email="" onClose=${() => setPdf(null)} />`}
    <//>`;
}

// ---------- Динамика измерений ----------

function LineChart({ points, reference }) {
  const W = 320, H = 170, padL = 34, padR = 10, padT = 12, padB = 24;
  const values = points.map((p) => p.value);
  const bounds = [];
  if (reference && reference.minValue !== null && reference.minValue !== undefined) bounds.push(reference.minValue);
  if (reference && reference.maxValue !== null && reference.maxValue !== undefined) bounds.push(reference.maxValue);
  let lo = Math.min(...values, ...bounds);
  let hi = Math.max(...values, ...bounds);
  if (hi === lo) { hi += 1; lo -= 1; }
  const span = hi - lo;
  lo -= span * 0.1;
  hi += span * 0.1;
  const x = (i) => padL + (points.length === 1 ? 0.5 : i / (points.length - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const every = points.length > 6 ? Math.ceil(points.length / 5) : 1;
  return html`
    <svg class="chart" viewBox=${`0 0 ${W} ${H}`} role="img" aria-label=${t('trend.title')}>
      ${bounds.map((b) => html`<g key=${'b' + b}>
        <line x1=${padL} y1=${y(b)} x2=${W - padR} y2=${y(b)} class="chart-norm" />
        <text x=${padL - 4} y=${y(b) + 3} text-anchor="end" class="chart-text">${fmtNum(b)}</text>
      </g>`)}
      <path d=${path} class="chart-line" />
      ${points.map((p, i) => html`<g key=${p.apptId}>
        <circle cx=${x(i)} cy=${y(p.value)} r="3.5" style=${'fill:' + (p.status && p.status !== 'normal' && p.status !== 'unknown' ? STATUS[p.status].color : 'var(--accent)')} />
        <text x=${x(i)} y=${y(p.value) - 7} text-anchor="middle" class="chart-text strong">${fmtNum(p.value)}</text>
        ${i % every === 0 && html`<text x=${x(i)} y=${H - 6} text-anchor="middle" class="chart-text">${fmtDate(p.date).slice(0, 5)}</text>`}
      </g>`)}
    </svg>`;
}

export function TrendScreen({ id }) {
  const d = useData();
  const patient = d.patients.get(id);
  const [selected, setSelected] = useState('');
  if (!patient) {
    return html`<${Screen} title=${t('trend.title')} backTo="/"><${Empty} icon="person" text=${t('patient.none')} /><//>`;
  }
  const studies = patientStudies(id);
  const series = collectSeries(studies);
  const options = Array.from(series.entries()).filter(([, pts]) => pts.length >= 2)
    .map(([key]) => { const e = FIELD_INDEX.get(key); return { key, label: systemById(e.system).short + ': ' + fieldLabel(e.system, e.field.key) }; });
  const current = options.find((o) => o.key === selected) || options[0];

  let chart = null;
  if (current) {
    const entry = FIELD_INDEX.get(current.key);
    const refIndex = buildRefIndex(d.references);
    const points = series.get(current.key).map((p) => {
      const ref = pickReference(refIndex, entry.field.ref, patientInfo(patient, p.date));
      return { ...p, ref, status: evaluate(ref, p.value) };
    });
    const lastRef = points[points.length - 1].ref;
    chart = html`
      <${Group} title=${current.label} footer=${hasRange(lastRef) ? t('reference.norm') + ': ' + rangeText(lastRef) : null}>
        <div class="row chart-row"><${LineChart} points=${points} reference=${lastRef} /></div>
      <//>
      <${Group} title=${t('trend.values')}>
        ${points.slice().reverse().map((p) => html`
          <${Row} key=${p.apptId} label=${fmtDate(p.date)} chevron onClick=${() => navigate('/a/' + p.apptId)}
            value=${html`${fmtNum(p.value)} ${entry.field.unit} ${p.status !== 'unknown' && html`<b style=${'color:' + STATUS[p.status].color}>${STATUS[p.status].symbol}</b>`}`} />`)}
      <//>`;
  }

  return html`
    <${Screen} title=${t('trend.title')} backTo=${'/patient/' + id}>
      ${options.length === 0
        ? html`<${Empty} icon="chart" text=${t('trend.need_two')} />`
        : html`
          <${Group} title=${patientName(patient)}>
            <label class="row field">
              <span class="row-label">${t('trend.parameter')}</span>
              <select class="select wide" value=${current.key} onChange=${(e) => setSelected(e.target.value)}>
                ${options.map((o) => html`<option key=${o.key} value=${o.key} selected=${o.key === current.key}>${o.label}</option>`)}
              </select>
            </label>
          <//>
          ${chart}`}
    <//>`;
}

// ---------- Сравнение двух исследований ----------

export function CompareScreen({ id }) {
  const d = useData();
  const patient = d.patients.get(id);
  const studies = patient ? patientStudies(id) : [];
  const [aId, setA] = useState('');
  const [bId, setB] = useState('');
  if (!patient) {
    return html`<${Screen} title=${t('compare.title')} backTo="/"><${Empty} icon="person" text=${t('patient.none')} /><//>`;
  }
  if (studies.length < 2) {
    return html`<${Screen} title=${t('compare.title')} backTo=${'/patient/' + id}><${Empty} icon="compare" text=${t('compare.need_two')} /><//>`;
  }
  // По умолчанию: предыдущее (слева) и последнее (справа).
  const first = studies.find((s) => s.id === aId) || studies[1];
  const second = studies.find((s) => s.id === bId) || studies[0];
  const refIndex = buildRefIndex(d.references);

  const rows = [];
  for (const s of SYSTEMS) {
    const blockA = normalizeBlocks(first.blocks).find((b) => b.system === s.id && b.enabled && hasContent(b));
    const blockB = normalizeBlocks(second.blocks).find((b) => b.system === s.id && b.enabled && hasContent(b));
    if (!blockA && !blockB) continue;
    const lines = [];
    for (const [key, entry] of FIELD_INDEX) {
      if (entry.system !== s.id) continue;
      const va = blockA ? fieldNumber(blockA, entry.field) : null;
      const vb = blockB ? fieldNumber(blockB, entry.field) : null;
      if (va === null && vb === null) continue;
      const refB = pickReference(refIndex, entry.field.ref, patientInfo(patient, second.date));
      const refA = pickReference(refIndex, entry.field.ref, patientInfo(patient, first.date));
      const delta = va !== null && vb !== null ? Math.round((vb - va) * 100) / 100 : null;
      lines.push({
        key, label: fieldLabel(s.id, entry.field.key), unit: entry.field.unit, va, vb, delta,
        sa: va === null ? 'unknown' : evaluate(refA, va), sb: vb === null ? 'unknown' : evaluate(refB, vb),
      });
    }
    if (lines.length) rows.push({ system: s, lines });
  }

  const select = (value, onChange) => html`
    <select class="select wide" value=${value} onChange=${(e) => onChange(e.target.value)}>
      ${studies.map((s) => html`<option key=${s.id} value=${s.id} selected=${s.id === value}>${fmtDateTime(s.date)} · ${studyShort(s) || '—'}</option>`)}
    </select>`;
  const cell = (v, status) => (v === null
    ? html`<span class="muted">—</span>`
    : html`<span style=${status !== 'unknown' && status !== 'normal' ? 'color:' + STATUS[status].color + ';font-weight:600' : ''}>${fmtNum(v)}</span>`);

  return html`
    <${Screen} title=${t('compare.title')} backTo=${'/patient/' + id}>
      <${Group} title=${patientName(patient)}>
        <label class="row field"><span class="row-label">${t('compare.first')}</span>${select(first.id, setA)}</label>
        <label class="row field"><span class="row-label">${t('compare.second')}</span>${select(second.id, setB)}</label>
      <//>
      ${rows.length === 0 && html`<${Empty} icon="compare" text=${t('compare.nothing')} />`}
      ${rows.map(({ system, lines }) => html`
        <${Group} key=${system.id} title=${t('system.' + system.id)}>
          <div class="row cmp-head">
            <span class="cmp-label"></span><span>${fmtDate(first.date).slice(0, 5)}</span><span>${fmtDate(second.date).slice(0, 5)}</span><span>Δ</span>
          </div>
          ${lines.map((l) => html`
            <div key=${l.key} class="row cmp-row">
              <span class="cmp-label">${l.label}${l.unit ? ', ' + l.unit : ''}</span>
              ${cell(l.va, l.sa)}
              ${cell(l.vb, l.sb)}
              <span class=${l.delta === null || l.delta === 0 ? 'muted' : 'cmp-delta'}>${l.delta === null ? '—' : l.delta === 0 ? '=' : (l.delta > 0 ? '↑ ' : '↓ ') + fmtNum(Math.abs(l.delta))}</span>
            </div>`)}
        <//>`)}
    <//>`;
}

// ---------- Общий поиск ----------

export function SearchScreen() {
  useData();
  const [query, setQuery] = useState('');
  const q = query.trim();
  const results = searchAppointments(q);
  const recent = q.length < 2 ? recentPatients(5) : [];

  return html`
    <${Screen} title=${t('search.title')} backTo="/">
      <${SearchBox} value=${query} onInput=${setQuery} placeholder=${t('search.placeholder')} />
      ${recent.length > 0 && html`
        <${Group} title=${t('patient.recent')}>
          ${recent.map((p) => html`<${Row} key=${p.id} label=${patientName(p)} icon="person" chevron
            sub=${birthText(p) + (p.cardNumber ? '  ·  № ' + p.cardNumber : '')} onClick=${() => navigate('/patient/' + p.id)} />`)}
        <//>`}
      ${q.length >= 2 && results.length === 0 && html`<${Empty} icon="search" text=${t('search.nothing')} />`}
      ${q.length < 2 && recent.length === 0 && html`<${Empty} icon="search" text=${t('search.hint')} />`}
      ${results.length > 0 && html`
        <${Group} title=${t('search.results', results.length)}>
          ${results.map((a) => {
            const p = patientOf(a);
            return html`<${Row} key=${a.id} label=${patientName(p)} chevron onClick=${() => navigate('/a/' + a.id)}
              sub=${[fmtDateTime(a.date) + (a.protocolNumber ? ' · № ' + a.protocolNumber : '') + (p && p.cardNumber ? ' · карта ' + p.cardNumber : ''),
                (a.conclusion || '').slice(0, 100)].filter(Boolean).join('\n')} />`;
          })}
        <//>`}
    <//>`;
}
