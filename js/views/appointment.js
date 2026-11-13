// Запись на УЗИ: форма (новая / изменение), протокол системы, карточка протокола, PDF.
import { html, useState, useEffect } from '../../vendor/standalone.module.js';
import { useData, getSettings, list } from '../db.js';
import { t } from '../i18n.js';
import { navigate, replace, back } from '../router.js';
import {
  Screen, NavButton, Group, Row, StackRow, TextRow, AreaRow, ToggleRow, SelectRow, Sheet, Icon, Empty, SearchBox,
  confirmDialog, alertDialog, toast,
} from '../ui.js';
import {
  SYSTEMS, SYSTEM_CONFIG, STATUS, DESCRIPTION_KEY, PROBE_PRESETS, systemById, visibleSections, isOptionOn, refKeyFor,
  evaluate, rangeText, hasRange, blockResults, enabledBlocks, studyTitle, filledCount, patientName, birthText,
} from '../models.js';
import {
  newDraft, draftFromAppointment, fillPatient, saveDraft, deleteAppointment, generateProtocolNumber, patientOf, lastEmail,
} from '../ops.js';
import {
  parseNum, fmtNum, fmtDateTime, toLocalInput, fromLocalInput, parseDayKey, defaultTime, isValidEmail, isValidBirth,
  shareFile, downloadBlob,
} from '../util.js';
import { buildProtocolPDF, pdfFileName, loadPdfMake } from '../pdf.js';

// ---------- Форма записи ----------

export function EditScreen({ id, dayKeyValue }) {
  const d = useData();
  const existing = id ? d.appointments.get(id) : null;
  const [draft, setDraft] = useState(() => (existing
    ? draftFromAppointment(existing)
    : newDraft(defaultTime(parseDayKey(dayKeyValue) || new Date()))));
  const [dirty, setDirty] = useState(false);
  const [sheet, setSheet] = useState(null);
  const [saving, setSaving] = useState(false);

  if (id && !existing && !saving) {
    return html`<${Screen} title=${t('appointment.edit')} backTo="/"><${Empty} text=${t('appointment.not_found')} /><//>`;
  }

  const set = (patch) => { setDraft((prev) => ({ ...prev, ...patch })); setDirty(true); };
  // next — новый блок или функция (старый блок) → новый блок.
  const setBlock = (index, next) => {
    setDraft((prev) => ({
      ...prev,
      blocks: prev.blocks.map((b, i) => (i === index ? (typeof next === 'function' ? next(b) : next) : b)),
    }));
    setDirty(true);
  };

  const birthOk = isValidBirth(draft.birthDay, draft.birthMonth, draft.birthYear);
  const emailOk = isValidEmail(draft.email);
  const canSave = draft.surname.trim() !== '' && birthOk && emailOk && !saving;
  const fallback = existing ? '/a/' + existing.id : '/';

  const cancel = async () => {
    if (dirty) {
      const ok = await confirmDialog({ title: t('edit.discard_confirm'), confirmLabel: t('edit.discard'), destructive: true });
      if (!ok) return;
    }
    back(fallback);
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const savedId = await saveDraft(draft);
      toast(t('common.saved'));
      if (existing) back('/a/' + savedId);
      else replace('/a/' + savedId);
    } catch (e) {
      setSaving(false);
      alertDialog(String((e && e.message) || e), t('common.error'));
    }
  };

  const pickedPatient = !existing && draft.patientId ? d.patients.get(draft.patientId) : null;
  const enabledSystems = draft.blocks.filter((b) => b.enabled).map((b) => b.system);

  return html`
    <${Screen} title=${existing ? t('appointment.edit') : t('appointment.new')}
      left=${html`<${NavButton} label=${t('common.cancel')} onClick=${cancel} />`}
      right=${html`<${NavButton} label=${t('common.save')} strong disabled=${!canSave} onClick=${save} />`}>

      <${Group} title=${t('section.patient')} footer=${draft.surname.trim() ? null : t('patient.surname_required')}>
        ${!existing && !pickedPatient && d.patients.size > 0 && html`
          <${Row} label=${t('patient.pick_existing')} icon="person" accent chevron onClick=${() => setSheet({ kind: 'patients' })} />`}
        ${pickedPatient && html`
          <${Row} label=${t('patient.from_base')} sub=${patientName(pickedPatient)} icon="person">
            <button class="link" onClick=${() => set({ patientId: null })}>${t('patient.detach')}</button>
          <//>`}
        <${TextRow} label=${t('patient.surname')} value=${draft.surname} onInput=${(v) => set({ surname: v })} autocapitalize="words" />
        <${TextRow} label=${t('patient.name')} value=${draft.name} onInput=${(v) => set({ name: v })} autocapitalize="words" />
        <${TextRow} label=${t('patient.middle_name')} value=${draft.middleName} onInput=${(v) => set({ middleName: v })} autocapitalize="words" />
        <div class="row field">
          <span class="row-label">${t('patient.gender')}</span>
          <div class="mini-seg">
            ${['Ж', 'М'].map((g) => html`<button key=${g} class=${draft.gender === g ? 'active' : ''}
              onClick=${() => set({ gender: g })}>${g === 'Ж' ? t('gender.female') : t('gender.male')}</button>`)}
          </div>
        </div>
        <div class="row field">
          <span class="row-label">${t('patient.birth_date')}</span>
          <span class="birth">
            <input class="input birth-part" inputmode="numeric" maxlength="2" placeholder=${t('date.dd')} value=${draft.birthDay}
              onInput=${(e) => set({ birthDay: e.target.value.replace(/\D/g, '') })} />
            <span class="muted">/</span>
            <input class="input birth-part" inputmode="numeric" maxlength="2" placeholder=${t('date.mm')} value=${draft.birthMonth}
              onInput=${(e) => set({ birthMonth: e.target.value.replace(/\D/g, '') })} />
            <span class="muted">/</span>
            <input class="input birth-year" inputmode="numeric" maxlength="4" placeholder=${t('date.yyyy')} value=${draft.birthYear}
              onInput=${(e) => set({ birthYear: e.target.value.replace(/\D/g, '') })} />
          </span>
        </div>
        ${!birthOk && html`<div class="row error-row">${t('patient.birth_date_invalid')}</div>`}
        <${TextRow} label=${t('patient.card_number')} value=${draft.cardNumber} onInput=${(v) => set({ cardNumber: v })} />
        <${TextRow} label=${t('patient.email')} value=${draft.email} type="email" inputmode="email" autocapitalize="off"
          onInput=${(v) => set({ email: v })} />
        ${!emailOk && html`<div class="row error-row">${t('patient.email_invalid')}</div>`}
      <//>

      <${Group} title=${t('section.protocol')}>
        <${TextRow} label=${t('protocol.number')} value=${draft.protocolNumber} onInput=${(v) => set({ protocolNumber: v })}>
          <button class="icon-btn small" aria-label=${t('protocol.regenerate')}
            onClick=${(e) => { e.preventDefault(); set({ protocolNumber: generateProtocolNumber(draft.date, draft.id) }); }}>
            <${Icon} name="refresh" size=${18} />
          </button>
        <//>
        <label class="row field">
          <span class="row-label">${t('protocol.date_time')}</span>
          <input class="input" type="datetime-local" value=${toLocalInput(draft.date)}
            onInput=${(e) => { const v = fromLocalInput(e.target.value); if (v) set({ date: v.toISOString() }); }} />
        </label>
      <//>

      <${Group} title=${t('section.technical')}>
        <${TextRow} label=${t('technical.us_system')} value=${draft.usSystemName} onInput=${(v) => set({ usSystemName: v })} />
        <${TextRow} label=${t('technical.probe')} value=${draft.probeType} onInput=${(v) => set({ probeType: v })} />
        <${SelectRow} label=${t('technical.probe_preset')} value=""
          options=${[{ value: '', label: t('common.choose') }, ...PROBE_PRESETS.map((p) => ({ value: p, label: p }))]}
          onChange=${(v) => { if (v) set({ probeType: v }); }} />
      <//>

      <${Group} title=${t('section.systems')} footer=${t('systems.footer')}>
        ${draft.blocks.map((b, i) => html`
          <${ToggleRow} key=${b.system} label=${t('system.' + b.system)} checked=${b.enabled}
            onChange=${(v) => setBlock(i, (blk) => ({ ...blk, enabled: v }))} />
          ${b.enabled && html`
            <${Row} key=${b.system + '-cfg'} label=${t('system.configure')} accent chevron
              value=${filledCount(b) > 0 ? t('system.filled', filledCount(b)) : null}
              onClick=${() => setSheet({ kind: 'protocol', index: i })} />`}`)}
      <//>

      <${Group} title=${t('section.study')}>
        <${AreaRow} label=${t('study.significant')} value=${draft.significantInfo} onInput=${(v) => set({ significantInfo: v })} />
        <${AreaRow} label=${t('study.additional')} value=${draft.additionalInfo} onInput=${(v) => set({ additionalInfo: v })} />
        <${AreaRow} label=${t('study.complications')} value=${draft.complications} onInput=${(v) => set({ complications: v })} />
      <//>

      <${Group} title=${t('section.conclusion')}>
        <${AreaRow} label=${t('conclusion.text')} value=${draft.conclusion} minRows=${3} onInput=${(v) => set({ conclusion: v })} />
        <${Row} label=${t('conclusion.pick_template')} icon="text" accent chevron onClick=${() => setSheet({ kind: 'templates' })} />
        <${TextRow} label=${t('conclusion.doctor')} value=${draft.doctorName} onInput=${(v) => set({ doctorName: v })} autocapitalize="words" />
      <//>

      <div class="pad">
        <button class="big-btn" disabled=${!canSave} onClick=${save}>${t('common.save')}</button>
      </div>

      ${sheet && sheet.kind === 'protocol' && html`
        <${ProtocolSheet} block=${draft.blocks[sheet.index]} gender=${draft.gender}
          onChange=${(b) => setBlock(sheet.index, b)} onClose=${() => setSheet(null)} />`}
      ${sheet && sheet.kind === 'patients' && html`
        <${PatientPicker} onClose=${() => setSheet(null)}
          onPick=${(p) => {
            setDraft((prev) => {
              const next = fillPatient(prev, p);
              if (!next.email) next.email = lastEmail(p.id);
              return next;
            });
            setDirty(true);
            setSheet(null);
          }} />`}
      ${sheet && sheet.kind === 'templates' && html`
        <${TemplatePicker} preferred=${enabledSystems} onClose=${() => setSheet(null)}
          onSelect=${(text) => {
            const current = draft.conclusion.trim();
            set({ conclusion: current ? current + '\n' + text : text });
            setSheet(null);
          }} />`}
    <//>`;
}

// ---------- Протокол системы ----------

function ProtocolSheet({ block, gender, onChange, onClose }) {
  const d = useData();
  const cfg = SYSTEM_CONFIG[block.system];
  const setField = (key, value) => onChange((b) => {
    const fields = { ...b.fields };
    if (value === '') delete fields[key];
    else fields[key] = value;
    return { ...b, fields };
  });
  const setOption = (key, value) => onChange((b) => ({ ...b, options: { ...b.options, [key]: value } }));

  return html`
    <${Sheet} title=${t('system.' + block.system)} onDone=${onClose}>
      ${cfg.options.length > 0 && html`
        <${Group} title=${t('protocol.options')}>
          ${cfg.options.map((o) => html`<${ToggleRow} key=${o.key} label=${o.title}
            checked=${isOptionOn(block.system, block, o.key)} onChange=${(v) => setOption(o.key, v)} />`)}
        <//>`}
      ${visibleSections(block).map((section) => html`
        <${Group} key=${section.title} title=${section.title}>
          ${section.fields.map((field) => {
            const refKey = refKeyFor(field, gender);
            return html`<${MeasureRow} key=${field.key} field=${field}
              value=${block.fields[field.key] || ''}
              computed=${field.compute ? field.compute(block.fields) : null}
              reference=${refKey ? d.references.get(refKey) || null : null}
              onInput=${(v) => setField(field.key, v)} />`;
          })}
        <//>`)}
      <${Group} title=${t('protocol.description')} footer=${t('protocol.footer_hint')}>
        <${AreaRow} value=${block.fields[DESCRIPTION_KEY] || ''} minRows=${3}
          placeholder=${t('protocol.description_placeholder')} onInput=${(v) => setField(DESCRIPTION_KEY, v)} />
      <//>
    <//>`;
}

function MeasureRow({ field, value, computed, reference, onInput }) {
  const typed = parseNum(value);
  const effective = typed !== null ? typed : computed;
  const hasComputed = computed !== null && computed !== undefined;
  return html`
    <div class="row measure">
      <label class="measure-top">
        <span class="row-label">${field.title}</span>
        <input class="input num" type="text" inputmode="decimal" value=${value}
          placeholder=${hasComputed ? '≈ ' + fmtNum(computed) : '—'}
          onInput=${(e) => onInput(e.target.value)} />
        <span class="unit">${field.unit}</span>
      </label>
      ${reference
        ? html`<${RefLabel} reference=${reference} value=${effective} isComputed=${typed === null && hasComputed} />`
        : hasComputed && !value && html`<span class="ref-label">${t('protocol.auto_calculated')}</span>`}
    </div>`;
}

export function RefLabel({ reference, value, isComputed }) {
  const status = value === null || value === undefined ? 'unknown' : evaluate(reference, value);
  const st = STATUS[status];
  return html`<span class="ref-label">
    ${status !== 'unknown' && html`<b style=${'color:' + st.color}>${st.symbol} ${t('status.' + status)}</b>${isComputed ? ' ' + t('protocol.auto_short') : ''} · `}
    ${t('reference.norm')}: ${rangeText(reference)}${reference.source ? ' · ' + reference.source : ''}
  </span>`;
}

// ---------- Выбор пациента ----------

function PatientPicker({ onPick, onClose }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const patients = list('patients')
    .sort((a, b) => patientName(a).localeCompare(patientName(b), 'ru'))
    .filter((p) => !q || patientName(p).toLowerCase().includes(q) || String(p.cardNumber || '').toLowerCase().includes(q));
  return html`
    <${Sheet} title=${t('patient.pick_existing')} onClose=${onClose}>
      <${SearchBox} value=${query} onInput=${setQuery} />
      ${patients.length === 0
        ? html`<${Empty} icon="person" text=${t('patient.none')} />`
        : html`<section class="group"><div class="card">
            ${patients.map((p) => html`<${Row} key=${p.id} label=${patientName(p)}
              sub=${birthText(p) + (p.cardNumber ? '  ·  № ' + p.cardNumber : '')} onClick=${() => onPick(p)} />`)}
          </div></section>`}
    <//>`;
}

// ---------- Выбор шаблона заключения ----------

export function templateGroups(templates, preferred) {
  const order = [...preferred, ...SYSTEMS.map((s) => s.id).filter((id) => !preferred.includes(id))];
  const groups = [];
  for (const id of order) {
    const items = templates.filter((x) => x.system === id);
    if (items.length) groups.push({ id, title: t('system.' + id), items });
  }
  const general = templates.filter((x) => !systemById(x.system));
  if (general.length) groups.push({ id: 'general', title: t('templates.general'), items: general });
  return groups;
}

function TemplatePicker({ preferred, onSelect, onClose }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const templates = list('templates')
    .sort((a, b) => a.title.localeCompare(b.title, 'ru'))
    .filter((x) => !q || x.title.toLowerCase().includes(q) || x.text.toLowerCase().includes(q));
  const groups = templateGroups(templates, preferred);
  return html`
    <${Sheet} title=${t('templates.pick')} onClose=${onClose}>
      <${SearchBox} value=${query} onInput=${setQuery} />
      ${groups.length === 0 && html`<${Empty} icon="text" text=${t('templates.empty')} />`}
      ${groups.map((g) => html`
        <${Group} key=${g.id} title=${g.title}>
          ${g.items.map((x) => html`<${Row} key=${x.id} label=${x.title} sub=${x.text} onClick=${() => onSelect(x.text)} />`)}
        <//>`)}
    <//>`;
}

// ---------- Карточка протокола ----------

export function DetailScreen({ id }) {
  const d = useData();
  const appt = d.appointments.get(id);
  const [busy, setBusy] = useState(false);
  const [pdf, setPdf] = useState(null);

  useEffect(() => {
    // Подгружаем библиотеку PDF заранее, чтобы кнопка срабатывала быстрее.
    const timer = setTimeout(() => { loadPdfMake().catch(() => {}); }, 600);
    return () => clearTimeout(timer);
  }, []);

  if (!appt) {
    return html`<${Screen} title=${t('section.protocol')} backTo="/"><${Empty} text=${t('appointment.not_found')} /><//>`;
  }
  const patient = patientOf(appt);
  const gender = (patient && patient.gender) || 'Ж';
  const blocks = enabledBlocks(appt);

  const makePdf = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const blob = await buildProtocolPDF(appt, patient, d.references, getSettings());
      setPdf({ blob, filename: pdfFileName(appt) });
    } catch (e) {
      alertDialog(String((e && e.message) || e), t('pdf.error'));
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    const ok = await confirmDialog({
      title: t('appointment.delete_confirm'),
      message: patientName(patient) + ', ' + fmtDateTime(appt.date),
      confirmLabel: t('common.delete'),
      destructive: true,
    });
    if (!ok) return;
    await deleteAppointment(appt.id);
    toast(t('appointment.deleted'));
    back('/');
  };

  const val = (v) => (v && String(v).trim() ? v : '—');

  return html`
    <${Screen} title=${patientName(patient)} backTo="/"
      right=${html`<${NavButton} label=${t('common.edit')} onClick=${() => navigate('/edit/' + appt.id)} />`}>

      <${Group}>
        <${Row} label=${busy ? t('pdf.building') : t('action.make_pdf')} icon="doc" accent chevron onClick=${makePdf} />
        <${Row} label=${t('action.send_email')} sub=${appt.email || t('mail.no_email')} icon="mail" accent chevron onClick=${makePdf} />
      <//>

      <${Group} title=${t('section.protocol')}>
        <${Row} label=${t('protocol.number')} value=${val(appt.protocolNumber)} />
        <${Row} label=${t('protocol.date_time')} value=${fmtDateTime(appt.date)} />
      <//>

      <${Group} title=${t('section.patient')}>
        <${Row} label=${t('patient.surname')} value=${val(patient && patient.surname)} />
        <${Row} label=${t('patient.name')} value=${val(patient && patient.name)} />
        <${Row} label=${t('patient.middle_name')} value=${val(patient && patient.middleName)} />
        <${Row} label=${t('patient.gender')} value=${val(patient && patient.gender)} />
        <${Row} label=${t('patient.birth_date')} value=${birthText(patient)} />
        <${Row} label=${t('patient.card_number')} value=${val(patient && patient.cardNumber)} />
        <${Row} label=${t('patient.email')} value=${val(appt.email)} />
      <//>

      <${Group} title=${t('section.technical')}>
        <${Row} label=${t('technical.us_system')} value=${val(appt.usSystemName)} />
        <${Row} label=${t('technical.probe')} value=${val(appt.probeType)} />
      <//>

      <${Group} title=${t('section.study')}>
        <${StackRow} label=${t('study.name')} value=${studyTitle(appt)} />
        <${StackRow} label=${t('study.significant')} value=${appt.significantInfo} />
        <${StackRow} label=${t('study.additional')} value=${appt.additionalInfo} />
        <${StackRow} label=${t('study.complications')} value=${appt.complications} />
      <//>

      ${blocks.map((block) => {
        const sections = blockResults(block, d.references, gender);
        const description = String(block.fields[DESCRIPTION_KEY] || '').trim();
        return html`
          <${Group} key=${block.system} title=${t('system.' + block.system)}>
            ${sections.length === 0 && !description && html`<div class="row muted">${t('protocol.no_measurements')}</div>`}
            ${sections.map((section) => html`
              <div key=${section.title} class="row stack results">
                <span class="results-title">${section.title}</span>
                ${section.lines.length === 0 && html`<span class="muted small">${t('protocol.no_measurements')}</span>`}
                ${section.lines.map((line) => html`
                  <div key=${line.title} class="result-line">
                    <div class="result-top">
                      <span>${line.title}</span>
                      <span class="result-value">${line.value}${line.unit ? ' ' + line.unit : ''}${line.computed ? '*' : ''}
                        ${line.status !== 'unknown' && html` <b style=${'color:' + STATUS[line.status].color}>${STATUS[line.status].symbol}</b>`}
                      </span>
                    </div>
                    ${hasRange(line.ref) && html`<span class="ref-label">${t('reference.norm')}: ${rangeText(line.ref)}</span>`}
                  </div>`)}
              </div>`)}
            ${description && html`<${StackRow} label=${t('protocol.description')} value=${description} />`}
          <//>`;
      })}

      <${Group} title=${t('section.conclusion')}>
        <div class="row stack"><span class="row-text">${val(appt.conclusion)}</span></div>
        <${Row} label=${t('conclusion.doctor')} value=${val(appt.doctorName)} />
      <//>

      <${Group}>
        <${Row} label=${t('appointment.delete')} icon="trash" destructive onClick=${del} />
      <//>

      ${pdf && html`<${PdfSheet} pdf=${pdf} email=${appt.email} title=${t('pdf.title')} onClose=${() => setPdf(null)} />`}
    <//>`;
}

function PdfSheet({ pdf, email, onClose }) {
  const canShare = !!(navigator.canShare && navigator.canShare({ files: [new File([pdf.blob], pdf.filename, { type: 'application/pdf' })] }));
  const sizeKb = Math.max(1, Math.round(pdf.blob.size / 1024));

  const share = async () => {
    // Копируем адрес и открываем «Поделиться» в одном нажатии — так требует iPhone.
    if (email && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(email).catch(() => {});
    }
    const result = await shareFile(pdf.blob, pdf.filename, pdf.filename);
    if (result === 'downloaded') toast(t('pdf.downloaded'));
  };
  const openPdf = () => {
    const url = URL.createObjectURL(pdf.blob);
    const w = window.open(url, '_blank');
    if (!w) downloadBlob(pdf.blob, pdf.filename);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  return html`
    <${Sheet} title=${t('pdf.title')} onClose=${onClose} closeLabel=${t('common.close')}>
      <${Group} footer=${!canShare ? t('pdf.desktop_hint') : email ? t('pdf.email_hint', email) : t('pdf.share_hint')}>
        <${Row} label=${pdf.filename} sub=${sizeKb + ' КБ'} icon="doc" />
        ${email && html`<${Row} label=${t('patient.email')} value=${email} />`}
      <//>
      <${Group}>
        <${Row} label=${canShare ? t('pdf.share') : t('pdf.download')} icon=${canShare ? 'share' : 'download'} accent onClick=${share} />
        <${Row} label=${t('pdf.open')} icon="doc" accent onClick=${openPdf} />
        ${canShare && html`<${Row} label=${t('pdf.download')} icon="download" accent
          onClick=${() => { downloadBlob(pdf.blob, pdf.filename); toast(t('pdf.downloaded')); }} />`}
      <//>
    <//>`;
}
