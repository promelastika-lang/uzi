// Запись на УЗИ: форма (новая / изменение), протокол системы, карточка протокола, PDF.
import { html, useState, useEffect, useRef } from '../../vendor/standalone.module.js';
import { useData, getSettings, list, getLocal, setLocal } from '../db.js';
import { t } from '../i18n.js';
import { navigate, replace, back } from '../router.js';
import {
  Screen, NavButton, Group, Row, StackRow, TextRow, AreaRow, ToggleRow, Sheet, Icon, Empty, SearchBox, Chips,
  confirmDialog, alertDialog, promptDialog, choiceDialog, toast,
} from '../ui.js';
import {
  SYSTEMS, SYSTEM_CONFIG, STATUS, DESCRIPTION_KEY, DISCLAIMER, PROBE_PRESETS, systemById, visibleSections, isOptionOn,
  evaluate, rangeText, hasRange, blockResults, blockStatus, enabledBlocks, studyTitle, studyShort, filledCount, hasContent,
  patientName, birthText, buildRefIndex, pickReference, patientInfo, fieldNumber, stepFor, autoConclusion, bmi, appliesText, lowerFirst,
} from '../models.js';
import {
  newDraft, draftFromAppointment, fillPatient, detachPatient, saveDraft, deleteAppointment, restoreAppointment,
  duplicateAppointment, generateProtocolNumber, patientOf, lastEmail, findDuplicatePatient, matchByCard, livePatients,
  recentPatients, patientStudies, studiesWithData, copyFromStudy, lastBlockFor, applyApptTemplate, saveAsApptTemplate,
  templateSystems, catalogItems, activeClinic,
} from '../ops.js';
import {
  parseNum, fmtNum, fmtDate, fmtDateTime, toLocalInput, fromLocalInput, parseDayKey, defaultTime, isValidEmail, isValidBirth,
  shareFile, downloadBlob,
} from '../util.js';
import { buildProtocolPDF, protocolFileName, loadPdfMake } from '../pdf.js';

const errText = (e) => String((e && e.message) || e);

/** Настройки PDF из общих настроек приложения. */
export function pdfOptions() {
  const s = getSettings();
  return { clinic: activeClinic(), showLogo: s.pdfLogo, showSources: s.pdfSources, showSignature: s.pdfSignature, fontScale: s.pdfFontScale };
}

const draftHasContent = (d) => !!(d && (d.surname || d.name || d.cardNumber || d.conclusion || (d.blocks || []).some((b) => b.enabled)));

// ---------- Форма записи ----------

export function EditScreen({ id, dayKeyValue }) {
  const d = useData();
  const existing = id ? d.appointments.get(id) : null;
  const day = parseDayKey(dayKeyValue) || new Date();
  const [draft, setDraft] = useState(() => (existing ? draftFromAppointment(existing) : newDraft(defaultTime(day))));
  const [dirty, setDirty] = useState(false);
  const [sheet, setSheet] = useState(null);
  const [saving, setSaving] = useState(false);
  const [probeText, setProbeText] = useState('');
  // После сохранения или отказа от записи отложенное автосохранение черновика не должно сработать.
  const draftClosed = useRef(false);

  // Черновик: при открытии новой записи предлагаем восстановить несохранённое.
  useEffect(() => {
    if (existing) return;
    const stored = getLocal('draft', null);
    if (!draftHasContent(stored)) return;
    choiceDialog({
      title: t('draft.found'),
      message: [stored.surname, stored.name].filter(Boolean).join(' ') || t('draft.unnamed'),
      options: [{ label: t('draft.restore'), value: 'restore' }, { label: t('draft.delete'), value: 'delete', destructive: true }],
    }).then((choice) => {
      if (choice === 'restore') { setDraft({ ...newDraft(defaultTime(day)), ...stored, id: null }); setDirty(true); }
      else if (choice === 'delete') setLocal('draft', null);
    });
  }, []);

  // Автосохранение черновика новой записи.
  useEffect(() => {
    if (existing || !dirty || saving) return undefined;
    const timer = setTimeout(() => { if (!draftClosed.current && draftHasContent(draft)) setLocal('draft', draft); }, 500);
    return () => clearTimeout(timer);
  }, [draft, dirty]);

  if (id && !existing && !saving) {
    return html`<${Screen} title=${t('appointment.edit')} backTo="/"><${Empty} text=${t('appointment.not_found')} /><//>`;
  }

  const set = (patch) => { setDraft((prev) => ({ ...prev, ...patch })); setDirty(true); };
  const update = (fn) => { setDraft(fn); setDirty(true); };
  // next — новый блок или функция (старый блок) → новый блок.
  const setBlock = (index, next) => update((prev) => ({
    ...prev,
    blocks: prev.blocks.map((b, i) => (i === index ? (typeof next === 'function' ? next(b) : next) : b)),
  }));

  const birthOk = isValidBirth(draft.birthDay, draft.birthMonth, draft.birthYear);
  const emailOk = isValidEmail(draft.email);
  const canSave = draft.surname.trim() !== '' && birthOk && emailOk && !saving;
  const fallback = existing ? '/a/' + existing.id : '/';

  const linked = draft.patientId ? d.patients.get(draft.patientId) : null;
  const linkedStudies = linked ? patientStudies(linked.id, draft.id) : [];
  const cardMatches = linked ? [] : matchByCard(draft.cardNumber);
  const refIndex = buildRefIndex(d.references);
  const info = patientInfo({
    gender: draft.gender,
    birthDay: parseInt(draft.birthDay, 10) || 0, birthMonth: parseInt(draft.birthMonth, 10) || 0, birthYear: parseInt(draft.birthYear, 10) || 0,
  }, draft.date);
  const enabled = draft.blocks.filter((b) => b.enabled);
  const filledSystems = enabled.filter(hasContent).length;
  const massIndex = bmi(draft.height, draft.weight);
  const machines = catalogItems('machine').filter((m) => m !== draft.usSystemName).slice(0, 6);
  const probeChoices = [...catalogItems('probe'), ...PROBE_PRESETS]
    .filter((p, i, arr) => arr.indexOf(p) === i && !draft.probes.includes(p)).slice(0, 8);

  const linkPatient = (p) => update((prev) => {
    const next = fillPatient(prev, p);
    if (!next.email) next.email = lastEmail(p.id);
    return next;
  });

  const addProbe = (name) => {
    const n = String(name || '').trim();
    if (!n) return;
    update((prev) => (prev.probes.includes(n) ? prev : { ...prev, probes: [...prev.probes, n] }));
    setProbeText('');
  };

  const cancel = async () => {
    if (dirty && !existing) {
      const choice = await choiceDialog({
        title: t('edit.leave_title'),
        options: [{ label: t('draft.keep'), value: 'keep' }, { label: t('edit.discard'), value: 'discard', destructive: true }],
      });
      if (choice === null) return;
      draftClosed.current = true;
      if (choice === 'keep') setLocal('draft', draft);
      else setLocal('draft', null);
    } else if (dirty) {
      const ok = await confirmDialog({ title: t('edit.discard_confirm'), confirmLabel: t('edit.discard'), destructive: true });
      if (!ok) return;
    }
    back(fallback);
  };

  const save = async () => {
    if (!canSave) return;
    const options = {};
    if (!draft.patientId) {
      const dup = findDuplicatePatient(draft);
      if (dup) {
        const choice = await choiceDialog({
          title: t('dup.title'),
          message: patientName(dup) + '\n' + birthText(dup) + (dup.cardNumber ? ' · № ' + dup.cardNumber : ''),
          options: [{ label: t('dup.use'), value: 'use' }, { label: t('dup.create'), value: 'create' }],
        });
        if (choice === null) return;
        if (choice === 'use') options.patientId = dup.id;
      }
    }
    setSaving(true);
    draftClosed.current = true;
    try {
      const savedId = await saveDraft(draft, options);
      setLocal('draft', null);
      if (existing) {
        toast(t('common.saved'));
        back('/a/' + savedId);
        return;
      }
      const next = await choiceDialog({
        title: t('saved.title'),
        options: [{ label: t('saved.next'), value: 'next' }, { label: t('saved.open'), value: 'open' }],
        cancelLabel: t('saved.calendar'),
      });
      if (next === 'next') {
        setDraft(newDraft(defaultTime(day)));
        setDirty(false);
        setSaving(false);
        draftClosed.current = false;
        window.scrollTo(0, 0);
      } else if (next === 'open') {
        replace('/a/' + savedId);
      } else {
        back('/');
      }
    } catch (e) {
      setSaving(false);
      draftClosed.current = false;
      alertDialog(errText(e), t('common.error'));
    }
  };

  const makeConclusion = () => {
    const text = autoConclusion(draft.blocks, refIndex, info);
    if (!text) { toast(t('conclusion.auto_empty')); return; }
    const current = draft.conclusion.trim();
    set({ conclusion: current ? current + '\n' + text : text });
  };
  const appendConclusion = (text) => {
    const current = draft.conclusion.trim();
    set({ conclusion: current ? current + '\n' + text : text });
    setSheet(null);
  };

  const subheader = html`
    <div class="subheader">
      <span class="sub-name">${draft.surname.trim()
        ? [draft.surname, draft.name].filter(Boolean).join(' ') + (draft.cardNumber ? ' · № ' + draft.cardNumber : '')
        : t('patient.new')}</span>
      <span class="sub-progress">${t('progress.systems', filledSystems, enabled.length)}</span>
    </div>`;

  return html`
    <${Screen} title=${existing ? t('appointment.edit') : t('appointment.new')} subheader=${subheader}
      left=${html`<${NavButton} label=${t('common.cancel')} onClick=${cancel} />`}
      right=${html`<${NavButton} label=${t('common.save')} strong disabled=${!canSave} onClick=${save} />`}>

      ${d.apptTemplates.size > 0 && html`
        <${Group}>
          <${Row} label=${t('appt_tpl.apply')} icon="spark" accent chevron onClick=${() => setSheet({ kind: 'apptTemplates' })} />
        <//>`}

      <${Group} title=${t('section.patient')} footer=${draft.surname.trim() ? null : t('patient.surname_required')}>
        ${linked
          ? html`
            <${Row} label=${patientName(linked)} icon="person"
              sub=${[linked.cardNumber && '№ ' + linked.cardNumber, t('patient.studies', linkedStudies.length)].filter(Boolean).join(' · ')}>
              <button class="link" onClick=${() => update(detachPatient)}>${t('patient.detach')}</button>
            <//>
            ${studiesWithData(linked.id, draft.id).length > 0 && html`
              <${Row} label=${t('previous.fill')} icon="history" accent chevron onClick=${() => setSheet({ kind: 'previous' })} />`}`
          : livePatients().length > 0 && html`
            <${Row} label=${t('patient.pick_existing')} icon="person" accent chevron onClick=${() => setSheet({ kind: 'patients' })} />`}
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
        ${cardMatches.map((p) => html`
          <${Row} key=${'m' + p.id} label=${patientName(p)} sub=${'№ ' + p.cardNumber + ' · ' + birthText(p)} icon="person" accent
            value=${t('patient.link')} onClick=${() => linkPatient(p)} />`)}
        <${TextRow} label=${t('patient.email')} value=${draft.email} type="email" inputmode="email" autocapitalize="off"
          onInput=${(v) => set({ email: v })} />
        ${!emailOk && html`<div class="row error-row">${t('patient.email_invalid')}</div>`}
        <${TextRow} label=${t('patient.height')} value=${draft.height} inputmode="numeric" placeholder="—"
          onInput=${(v) => set({ height: v.replace(/\D/g, '').slice(0, 3) })} />
        <${TextRow} label=${t('patient.weight')} value=${draft.weight} inputmode="decimal" placeholder="—"
          onInput=${(v) => set({ weight: v.replace(/[^0-9.,]/g, '').slice(0, 5) })} />
        ${massIndex !== null && html`<${Row} label=${t('patient.bmi')} value=${fmtNum(massIndex)} />`}
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
        ${machines.length > 0 && html`<div class="row chips-row"><${Chips} items=${machines} onPick=${(m) => set({ usSystemName: m })} /></div>`}
        ${draft.probes.map((p) => html`
          <div key=${'p' + p} class="row">
            <span class="row-label">${p}</span>
            <button class="icon-btn small" aria-label=${t('common.delete')}
              onClick=${() => update((prev) => ({ ...prev, probes: prev.probes.filter((x) => x !== p) }))}>
              <${Icon} name="close" size=${18} />
            </button>
          </div>`)}
        <${TextRow} label=${t('technical.probe_add')} value=${probeText} onInput=${setProbeText} placeholder=${t('technical.probe_placeholder')}>
          <button class="icon-btn small" aria-label=${t('technical.probe_add')} disabled=${!probeText.trim()}
            onClick=${(e) => { e.preventDefault(); addProbe(probeText); }}>
            <${Icon} name="plus" size=${18} />
          </button>
        <//>
        ${probeChoices.length > 0 && html`<div class="row chips-row"><${Chips} items=${probeChoices} onPick=${addProbe} /></div>`}
      <//>

      <${Group} title=${t('section.systems')} footer=${t('systems.footer')}>
        ${draft.blocks.map((b, i) => {
          const st = b.enabled ? blockStatus(b, refIndex, info) : null;
          return html`
            <${ToggleRow} key=${b.system} label=${t('system.' + b.system)} checked=${b.enabled}
              onChange=${(v) => setBlock(i, (blk) => ({ ...blk, enabled: v }))} />
            ${b.enabled && html`
              <${Row} key=${b.system + '-cfg'} label=${t('system.configure')} accent chevron
                value=${html`${st.abnormal > 0 && html`<b class="c-red">⚠ ${st.abnormal} </b>`}${filledCount(b) > 0 ? t('system.filled', filledCount(b)) : ''}`}
                onClick=${() => setSheet({ kind: 'protocol', index: i })} />`}`;
        })}
      <//>

      <${Group} title=${t('section.study')}>
        <${AreaRow} label=${t('study.significant')} value=${draft.significantInfo} placeholder=${t('common.dictate')} onInput=${(v) => set({ significantInfo: v })} />
        <${AreaRow} label=${t('study.additional')} value=${draft.additionalInfo} placeholder=${t('common.dictate')} onInput=${(v) => set({ additionalInfo: v })} />
        <${AreaRow} label=${t('study.complications')} value=${draft.complications} placeholder=${t('common.dictate')} onInput=${(v) => set({ complications: v })} />
      <//>

      <${Group} title=${t('section.conclusion')} footer=${t('conclusion.footer')}>
        <${AreaRow} label=${t('conclusion.text')} value=${draft.conclusion} minRows=${3} placeholder=${t('common.dictate')}
          onInput=${(v) => set({ conclusion: v })} />
        <${Row} label=${t('conclusion.auto')} icon="spark" accent onClick=${makeConclusion} />
        <${Row} label=${t('conclusion.pick_template')} icon="text" accent chevron onClick=${() => setSheet({ kind: 'templates' })} />
        <${Row} label=${t('conclusion.pick_pathology')} icon="list" accent chevron onClick=${() => setSheet({ kind: 'pathologies' })} />
        <${TextRow} label=${t('conclusion.doctor')} value=${draft.doctorName} onInput=${(v) => set({ doctorName: v })} autocapitalize="words" />
      <//>

      <div class="pad">
        <button class="big-btn" disabled=${!canSave} onClick=${save}>${t('common.save')}</button>
      </div>

      ${sheet && sheet.kind === 'protocol' && html`
        <${ProtocolSheet} block=${draft.blocks[sheet.index]} info=${info} patientId=${draft.patientId} excludeId=${draft.id}
          onChange=${(b) => setBlock(sheet.index, b)} onClose=${() => setSheet(null)} />`}
      ${sheet && sheet.kind === 'patients' && html`
        <${PatientPicker} onClose=${() => setSheet(null)} onPick=${(p) => { linkPatient(p); setSheet(null); }} />`}
      ${sheet && sheet.kind === 'previous' && linked && html`
        <${PreviousStudyPicker} patientId=${linked.id} excludeId=${draft.id} onClose=${() => setSheet(null)}
          onPick=${(a) => { update((prev) => copyFromStudy(prev, a)); setSheet(null); toast(t('previous.copied')); }} />`}
      ${sheet && sheet.kind === 'apptTemplates' && html`
        <${ApptTemplatePicker} onClose=${() => setSheet(null)}
          onPick=${(tpl) => { update((prev) => applyApptTemplate(prev, tpl)); setSheet(null); toast(t('appt_tpl.applied')); }} />`}
      ${sheet && sheet.kind === 'templates' && html`
        <${TextPicker} title=${t('templates.pick')} store="templates" preferred=${enabled.map((b) => b.system)}
          onClose=${() => setSheet(null)} onSelect=${appendConclusion} />`}
      ${sheet && sheet.kind === 'pathologies' && html`
        <${TextPicker} title=${t('pathology.pick')} store="pathologies" preferred=${enabled.map((b) => b.system)}
          onClose=${() => setSheet(null)} onSelect=${appendConclusion} />`}
    <//>`;
}

// ---------- Протокол системы ----------

function ProtocolSheet({ block, info, patientId, excludeId, onChange, onClose }) {
  const d = useData();
  const cfg = SYSTEM_CONFIG[block.system];
  const refIndex = buildRefIndex(d.references);
  const last = lastBlockFor(patientId, block.system, excludeId);
  const status = blockStatus(block, refIndex, info);

  const setField = (key, value) => onChange((b) => {
    const fields = { ...b.fields };
    if (value === '') delete fields[key];
    else fields[key] = value;
    return { ...b, fields };
  });
  const setOption = (key, value) => onChange((b) => ({ ...b, options: { ...b.options, [key]: value } }));
  const copyLast = () => {
    onChange((b) => ({ ...b, fields: { ...last.block.fields }, options: { ...last.block.options } }));
    toast(t('previous.copied'));
  };

  // «Далее» на клавиатуре переводит к следующему измерению.
  const onKeyDown = (e) => {
    if (e.key !== 'Enter' || !e.target.classList || !e.target.classList.contains('num')) return;
    e.preventDefault();
    const inputs = Array.from(document.querySelectorAll('.sheet input.num'));
    const next = inputs[inputs.indexOf(e.target) + 1];
    if (next) next.focus();
    else e.target.blur();
  };

  const badge = status.abnormal > 0
    ? html`<span class="status-badge c-red">⚠ ${status.abnormal}</span>`
    : status.evaluated > 0
      ? html`<span class="status-badge c-green">✓</span>`
      : html`<span class="status-badge muted">—</span>`;

  return html`
    <${Sheet} title=${t('system.' + block.system)} onDone=${onClose} left=${badge}>
      <div onKeyDown=${onKeyDown}>
        ${last && html`
          <${Group} title=${t('previous.last_time') + ' · ' + fmtDate(last.appointment.date)}>
            <div class="row stack">
              ${blockResults(last.block, refIndex, info).map((section) => html`
                <span key=${section.title} class="prev-line">
                  <b>${section.title}:</b> ${section.lines.map((line, i) => html`${i > 0 ? ', ' : ''}${lowerFirst(line.title)} ${
                    line.status !== 'unknown' && line.status !== 'normal'
                      ? html`<b style=${'color:' + STATUS[line.status].color}>${line.value}</b>` : line.value}`)}
                </span>`)}
            </div>
            <${Row} label=${t('previous.copy_all')} icon="copy" accent onClick=${copyLast} />
          <//>`}
        ${cfg.options.length > 0 && html`
          <${Group} title=${t('protocol.options')}>
            ${cfg.options.map((o) => html`<${ToggleRow} key=${o.key} label=${o.title}
              checked=${isOptionOn(block.system, block, o.key)} onChange=${(v) => setOption(o.key, v)} />`)}
          <//>`}
        ${visibleSections(block).map((section) => html`
          <${Group} key=${section.title} title=${section.title}>
            ${section.fields.map((field) => html`<${MeasureRow} key=${field.key} field=${field}
              value=${block.fields[field.key] || ''}
              computed=${field.compute ? field.compute(block.fields) : null}
              reference=${pickReference(refIndex, field.ref, info)}
              previous=${last ? fieldNumber(last.block, field) : null}
              onInput=${(v) => setField(field.key, v)} />`)}
          <//>`)}
        <${Group} title=${t('protocol.description')} footer=${t('protocol.footer_hint')}>
          <${AreaRow} value=${block.fields[DESCRIPTION_KEY] || ''} minRows=${3}
            placeholder=${t('protocol.description_placeholder')} onInput=${(v) => setField(DESCRIPTION_KEY, v)} />
        <//>
      </div>
    <//>`;
}

function MeasureRow({ field, value, computed, reference, previous, onInput }) {
  const typed = parseNum(value);
  const hasComputed = computed !== null && computed !== undefined;
  const effective = typed !== null ? typed : (hasComputed ? computed : null);
  const hasPrevious = previous !== null && previous !== undefined;
  const step = stepFor(field.unit);

  const bump = (dir) => {
    const base = typed !== null ? typed : (hasComputed ? computed : (hasPrevious ? previous : 0));
    const next = Math.max(0, Math.round((base + dir * step) * 100) / 100);
    onInput(fmtNum(next));
  };

  return html`
    <div class="row measure">
      <div class="measure-top">
        <span class="row-label">${field.title}</span>
        <button class="step-btn" tabindex="-1" aria-label="−" onClick=${() => bump(-1)}><${Icon} name="minus" size=${16} /></button>
        <input class="input num" type="text" inputmode="decimal" enterkeyhint="next" value=${value}
          aria-label=${field.title}
          placeholder=${hasComputed ? '≈ ' + fmtNum(computed) : '—'}
          onInput=${(e) => onInput(e.target.value)} />
        <button class="step-btn" tabindex="-1" aria-label="+" onClick=${() => bump(1)}><${Icon} name="plus" size=${16} /></button>
        <span class="unit">${field.unit}</span>
      </div>
      ${reference
        ? html`<${RefLabel} reference=${reference} value=${effective} isComputed=${typed === null && hasComputed} />`
        : hasComputed && !value && html`<span class="ref-label">${t('protocol.auto_calculated')}</span>`}
      ${(hasPrevious || value) && html`
        <span class="measure-tools">
          ${hasPrevious && html`<button class="link small" onClick=${() => onInput(fmtNum(previous))}>${t('previous.value', fmtNum(previous))}</button>`}
          ${value && html`<button class="link small muted" onClick=${() => onInput('')}>× ${t('common.clear')}</button>`}
        </span>`}
    </div>`;
}

export function RefLabel({ reference, value, isComputed }) {
  const status = value === null || value === undefined ? 'unknown' : evaluate(reference, value);
  const st = STATUS[status];
  const who = appliesText(reference);
  return html`<span class="ref-label">
    ${status !== 'unknown' && html`<b style=${'color:' + st.color}>${st.symbol} ${t('status.' + status)}</b>${isComputed ? ' ' + t('protocol.auto_short') : ''} · `}
    ${t('reference.norm')}${who ? ' (' + who + ')' : ''}: ${rangeText(reference)}${reference.source ? ' · ' + reference.source : ''}
  </span>`;
}

// ---------- Выбор пациента ----------

export function PatientPicker({ onPick, onClose }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const all = livePatients().sort((a, b) => patientName(a).localeCompare(patientName(b), 'ru'));
  const patients = all.filter((p) => !q || patientName(p).toLowerCase().includes(q) || String(p.cardNumber || '').toLowerCase().includes(q));
  const recent = q ? [] : recentPatients(5);
  const row = (p, prefix) => html`<${Row} key=${prefix + p.id} label=${patientName(p)}
    sub=${birthText(p) + (p.cardNumber ? '  ·  № ' + p.cardNumber : '')} onClick=${() => onPick(p)} />`;
  return html`
    <${Sheet} title=${t('patient.pick_existing')} onClose=${onClose}>
      <${SearchBox} value=${query} onInput=${setQuery} placeholder=${t('patient.search')} />
      ${recent.length > 0 && html`<${Group} title=${t('patient.recent')}>${recent.map((p) => row(p, 'r'))}<//>`}
      ${patients.length === 0
        ? html`<${Empty} icon="person" text=${t('patient.none')} />`
        : html`<${Group} title=${t('patient.all')}>${patients.map((p) => row(p, 'a'))}<//>`}
    <//>`;
}

function PreviousStudyPicker({ patientId, excludeId, onPick, onClose }) {
  const studies = studiesWithData(patientId, excludeId);
  return html`
    <${Sheet} title=${t('previous.pick')} onClose=${onClose}>
      ${studies.length === 0 && html`<${Empty} icon="history" text=${t('previous.none')} />`}
      ${studies.length > 0 && html`
        <${Group} footer=${t('previous.footer')}>
          ${studies.map((a) => html`<${Row} key=${a.id} label=${fmtDateTime(a.date)}
            sub=${[studyShort(a), (a.conclusion || '').slice(0, 90)].filter(Boolean).join('\n')} onClick=${() => onPick(a)} />`)}
        <//>`}
    <//>`;
}

function ApptTemplatePicker({ onPick, onClose }) {
  const templates = list('apptTemplates').sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  return html`
    <${Sheet} title=${t('appt_tpl.pick')} onClose=${onClose}>
      ${templates.length === 0 && html`<${Empty} icon="spark" text=${t('appt_tpl.empty')} />`}
      ${templates.length > 0 && html`
        <${Group} footer=${t('appt_tpl.footer')}>
          ${templates.map((x) => html`<${Row} key=${x.id} label=${x.title}
            sub=${[templateSystems(x), (x.conclusion || '').slice(0, 90)].filter(Boolean).join('\n')} onClick=${() => onPick(x)} />`)}
        <//>`}
    <//>`;
}

// ---------- Выбор шаблона заключения или патологии ----------

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

function TextPicker({ title, store, preferred, onSelect, onClose }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const items = list(store)
    .sort((a, b) => a.title.localeCompare(b.title, 'ru'))
    .filter((x) => !q || x.title.toLowerCase().includes(q) || x.text.toLowerCase().includes(q));
  const groups = templateGroups(items, preferred);
  return html`
    <${Sheet} title=${title} onClose=${onClose}>
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

  if (!appt || appt.deletedAt) {
    return html`<${Screen} title=${t('section.protocol')} backTo="/"><${Empty} text=${t('appointment.not_found')} /><//>`;
  }
  const patient = patientOf(appt);
  const refIndex = buildRefIndex(d.references);
  const info = patientInfo(patient, appt.date);
  const blocks = enabledBlocks(appt);
  const massIndex = patient ? bmi(patient.height, patient.weight) : null;
  const log = (appt.changeLog || []).slice().reverse();
  const edited = appt.updatedAt && appt.createdAt && appt.updatedAt !== appt.createdAt;

  const makePdf = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const blob = await buildProtocolPDF(appt, patient, d.references, pdfOptions());
      setPdf({ blob, filename: protocolFileName(appt, patient) });
    } catch (e) {
      alertDialog(errText(e), t('pdf.error'));
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    const ok = await confirmDialog({
      title: t('appointment.delete_confirm'),
      message: patientName(patient) + ', ' + fmtDateTime(appt.date) + '\n' + t('trash.note'),
      confirmLabel: t('common.delete'),
      destructive: true,
    });
    if (!ok) return;
    await deleteAppointment(appt.id);
    toast(t('appointment.deleted'), { label: t('common.undo'), run: () => restoreAppointment(appt.id) });
    back('/');
  };

  const copyConclusion = async () => {
    try {
      await navigator.clipboard.writeText(appt.conclusion || '');
      toast(t('common.copied'));
    } catch (e) {
      alertDialog(t('common.copy_failed'));
    }
  };

  const saveTemplate = async () => {
    const title = await promptDialog({ title: t('appt_tpl.save'), message: t('appt_tpl.save_hint'), placeholder: t('templates.title'), value: studyShort(appt) });
    if (title === null) return;
    await saveAsApptTemplate(appt, title);
    toast(t('common.saved'));
  };

  const exportJson = async () => {
    const payload = { app: 'uzi-protocols', kind: 'protocol', exportedAt: new Date().toISOString(), patient, appointment: appt };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const name = protocolFileName(appt, patient, 'json');
    const result = await shareFile(blob, name, name);
    if (result === 'downloaded') toast(t('exchange.export_done'));
  };

  const duplicate = async () => {
    const newId = await duplicateAppointment(appt.id);
    if (newId) { toast(t('appointment.duplicated')); navigate('/edit/' + newId); }
  };

  const val = (v) => (v && String(v).trim() ? v : '—');

  return html`
    <${Screen} title=${patientName(patient)} backTo="/"
      right=${html`<${NavButton} label=${t('common.edit')} onClick=${() => navigate('/edit/' + appt.id)} />`}>

      <${Group} footer=${(appt.conclusion || '').trim() ? null : t('pdf.draft_note')}>
        <${Row} label=${busy ? t('pdf.building') : t('action.make_pdf')} icon="doc" accent chevron onClick=${makePdf} />
        <${Row} label=${t('action.send_email')} sub=${appt.email || t('mail.no_email')} icon="mail" accent chevron onClick=${makePdf} />
        ${patient && html`<${Row} label=${t('history.open')} icon="history" accent chevron onClick=${() => navigate('/patient/' + patient.id)} />`}
      <//>

      <${Group} title=${t('section.protocol')}>
        <${Row} label=${t('protocol.number')} value=${val(appt.protocolNumber)} />
        <${Row} label=${t('protocol.date_time')} value=${fmtDateTime(appt.date)} />
        ${edited && html`<${Row} label=${t('protocol.updated')} value=${fmtDateTime(appt.updatedAt)} />`}
      <//>

      <${Group} title=${t('section.patient')}>
        <${Row} label=${t('patient.surname')} value=${val(patient && patient.surname)} />
        <${Row} label=${t('patient.name')} value=${val(patient && patient.name)} />
        <${Row} label=${t('patient.middle_name')} value=${val(patient && patient.middleName)} />
        <${Row} label=${t('patient.gender')} value=${val(patient && patient.gender)} />
        <${Row} label=${t('patient.birth_date')} value=${birthText(patient) + (info.age !== null ? ' (' + t('patient.age', info.age) + ')' : '')} />
        <${Row} label=${t('patient.card_number')} value=${val(patient && patient.cardNumber)} />
        <${Row} label=${t('patient.email')} value=${val(appt.email)} />
        ${patient && (patient.height || patient.weight) && html`
          <${Row} label=${t('patient.height_weight')}
            value=${[patient.height && patient.height + ' см', patient.weight && fmtNum(patient.weight) + ' кг', massIndex !== null && t('patient.bmi') + ' ' + fmtNum(massIndex)].filter(Boolean).join(' · ')} />`}
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

      ${blocks.map((block) => html`<${BlockResults} key=${block.system} block=${block} refIndex=${refIndex} info=${info} />`)}

      <${Group} title=${t('section.conclusion')} footer=${DISCLAIMER}>
        <div class="row stack"><span class="row-text">${val(appt.conclusion)}</span></div>
        ${(appt.conclusion || '').trim() && html`<${Row} label=${t('conclusion.copy')} icon="copy" accent onClick=${copyConclusion} />`}
        <${Row} label=${t('conclusion.doctor')} value=${val(appt.doctorName)} />
      <//>

      <${Group} title=${t('detail.more')}>
        <${Row} label=${t('appt_tpl.save')} icon="spark" accent onClick=${saveTemplate} />
        <${Row} label=${t('appointment.duplicate')} icon="copy" accent onClick=${duplicate} />
        <${Row} label=${t('detail.export_json')} icon="share" accent onClick=${exportJson} />
      <//>

      ${log.length > 0 && html`
        <${Group} title=${t('audit.title')}>
          ${log.slice(0, 20).map((entry, i) => html`
            <div key=${i} class="row stack">
              <span class="row-caption">${fmtDateTime(entry.at)}</span>
              <span class="row-text small">${(entry.changes || []).join(', ')}</span>
            </div>`)}
        <//>`}

      <${Group}>
        <${Row} label=${t('appointment.delete')} icon="trash" destructive onClick=${del} />
      <//>

      ${pdf && html`<${PdfSheet} pdf=${pdf} email=${appt.email} onClose=${() => setPdf(null)} />`}
    <//>`;
}

/** Блок системы с измерениями и статусами — в карточке протокола и в истории пациента. */
export function BlockResults({ block, refIndex, info }) {
  const sections = blockResults(block, refIndex, info);
  const description = String(block.fields[DESCRIPTION_KEY] || '').trim();
  return html`
    <${Group} title=${t('system.' + block.system)}>
      ${sections.length === 0 && !description && html`<div class="row muted">${t('protocol.no_measurements')}</div>`}
      ${sections.map((section) => html`
        <div key=${section.title} class="row stack results">
          <span class="results-title">${section.title}</span>
          ${section.lines.length === 0 && html`<span class="muted small">${t('protocol.no_measurements')}</span>`}
          ${section.lines.map((line) => html`
            <div key=${line.key} class="result-line">
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
}

/** Окно с готовым PDF: отправить, открыть, скачать. */
export function PdfSheet({ pdf, email, onClose }) {
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
