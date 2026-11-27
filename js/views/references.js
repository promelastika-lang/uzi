// Справочник норм: список, редактирование, экспорт/импорт JSON с предпросмотром, история версий.
import { html, useState, useRef } from '../../vendor/standalone.module.js';
import { useData, put, remove } from '../db.js';
import { t, locale } from '../i18n.js';
import { navigate, replace, back } from '../router.js';
import {
  Screen, NavButton, Group, Row, TextRow, AreaRow, SelectRow, Segmented, Sheet, Icon, Empty, SearchBox,
  confirmDialog, alertDialog, promptDialog, toast,
} from '../ui.js';
import { rangeText, sourceText, formatRange, seedItem, appliesText } from '../models.js';
import {
  sortedRefs, toItem, exportJSON, parseExport, diffItems, diffEffect, applyImport,
  snapshot, restoreVersion, resetToDefaults, seedSummary,
} from '../exchange.js';
import { parseNum, fmtNum, fileDate, shareFile, downloadBlob, readFileText, uid } from '../util.js';

const errText = (e) => String((e && e.message) || e);

// ---------- Список ----------

export function ReferencesScreen() {
  useData();
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const all = sortedRefs();
  const filtered = q
    ? all.filter((r) => r.title.toLowerCase().includes(q) || r.organ.toLowerCase().includes(q) || String(r.source || '').toLowerCase().includes(q))
    : all;
  const groups = [];
  for (const r of filtered) {
    let g = groups.find((x) => x.organ === r.organ);
    if (!g) { g = { organ: r.organ, items: [] }; groups.push(g); }
    g.items.push(r);
  }

  const reset = async () => {
    const ok = await confirmDialog({
      title: t('references.reset_confirm'), message: t('references.reset_message'),
      confirmLabel: t('references.reset'), destructive: true,
    });
    if (!ok) return;
    try {
      await resetToDefaults();
      toast(t('references.reset_done'));
    } catch (e) {
      alertDialog(errText(e), t('common.error'));
    }
  };

  return html`
    <${Screen} title=${t('references')} tabs>
      <${SearchBox} value=${query} onInput=${setQuery} />
      ${all.length === 0 && html`<${Empty} icon="book" text=${t('references.empty')} />`}
      ${groups.map((g) => html`
        <${Group} key=${g.organ} title=${g.organ}>
          ${g.items.map((r) => html`<${Row} key=${r.key} label=${r.title + (appliesText(r) ? ' (' + appliesText(r) + ')' : '')}
            sub=${sourceText(r)} value=${rangeText(r)}
            chevron onClick=${() => navigate('/ref/' + encodeURIComponent(r.key))} />`)}
        <//>`)}
      ${!q && html`
        <${Group} title=${t('references.manage')} footer=${t('references.disclaimer')}>
          <${Row} label=${t('references.import_export')} icon="swap" accent chevron onClick=${() => navigate('/refs/exchange')} />
          <${Row} label=${t('references.versions')} icon="clock" accent chevron onClick=${() => navigate('/refs/versions')} />
          <${Row} label=${t('references.reset')} icon="refresh" destructive onClick=${reset} />
        <//>`}
    <//>`;
}

// ---------- Редактирование нормы ----------

export function ReferenceEditScreen({ refKey }) {
  const d = useData();
  const original = d.references.get(refKey);
  const [form, setForm] = useState(() => (original ? {
    title: original.title || '',
    unit: original.unit || '',
    min: original.minValue === null || original.minValue === undefined ? '' : fmtNum(original.minValue),
    max: original.maxValue === null || original.maxValue === undefined ? '' : fmtNum(original.maxValue),
    source: original.source || '',
    sourcePage: original.sourcePage || '',
    note: original.note || '',
    gender: original.gender || '',
    minAge: original.minAge === null || original.minAge === undefined ? '' : String(original.minAge),
    maxAge: original.maxAge === null || original.maxAge === undefined ? '' : String(original.maxAge),
  } : null));
  const [dirty, setDirty] = useState(false);

  if (!original || !form) {
    return html`<${Screen} title=${t('references')} backTo="/refs"><${Empty} icon="book" text=${t('reference.not_found')} /><//>`;
  }

  const set = (patch) => { setForm((prev) => ({ ...prev, ...patch })); setDirty(true); };
  const min = parseNum(form.min);
  const max = parseNum(form.max);
  const badNumber = (form.min.trim() !== '' && min === null) || (form.max.trim() !== '' && max === null);
  const badRange = min !== null && max !== null && min > max;
  const minAge = form.minAge.trim() === '' ? null : parseInt(form.minAge, 10);
  const maxAge = form.maxAge.trim() === '' ? null : parseInt(form.maxAge, 10);
  const badAge = (minAge !== null && !(minAge >= 0 && minAge < 130)) || (maxAge !== null && !(maxAge >= 0 && maxAge < 130))
    || (minAge !== null && maxAge !== null && minAge > maxAge);
  const canSave = dirty && !badNumber && !badRange && !badAge && form.title.trim() !== '';
  const seed = seedItem(refKey);
  const baseKey = original.variantOf || original.key;
  const variants = sortedRefs().filter((r) => r.key !== original.key && (r.variantOf || r.key) === baseKey);

  const save = async () => {
    if (!canSave) return;
    await put('references', {
      ...original,
      title: form.title.trim(),
      unit: form.unit.trim(),
      minValue: min,
      maxValue: max,
      source: form.source.trim(),
      sourcePage: form.sourcePage.trim(),
      note: form.note.trim(),
      gender: form.gender,
      minAge,
      maxAge,
    });
    toast(t('common.saved'));
    back('/refs');
  };

  // Вариант нормы для другого пола или возраста: копия параметра со своими границами.
  const addVariant = async () => {
    const key = baseKey + '__' + uid().slice(0, 8);
    await put('references', { ...toItem(original), key, variantOf: baseKey, gender: '', minAge: null, maxAge: null, sortIndex: (original.sortIndex ?? 0) + 0.5 });
    replace('/ref/' + encodeURIComponent(key));
  };

  const removeVariant = async () => {
    const ok = await confirmDialog({ title: t('reference.delete_confirm'), message: original.title + ' — ' + (appliesText(original) || rangeText(original)), confirmLabel: t('common.delete'), destructive: true });
    if (!ok) return;
    await remove('references', original.key);
    back('/refs');
  };

  const restore = async () => {
    const ok = await confirmDialog({ title: t('reference.restore_default') + '?', message: seedSummary(seed), confirmLabel: t('reference.restore') });
    if (!ok) return;
    await put('references', { ...toItem(seed), sortIndex: original.sortIndex ?? 0 });
    toast(t('common.saved'));
    back('/refs');
  };

  const cancel = async () => {
    if (dirty) {
      const ok = await confirmDialog({ title: t('edit.discard_confirm'), confirmLabel: t('edit.discard'), destructive: true });
      if (!ok) return;
    }
    back('/refs');
  };

  return html`
    <${Screen} title=${original.title}
      left=${html`<${NavButton} label=${t('common.cancel')} onClick=${cancel} />`}
      right=${html`<${NavButton} label=${t('common.save')} strong disabled=${!canSave} onClick=${save} />`}>
      <${Group} title=${t('reference.section.parameter')}>
        <${Row} label=${t('reference.organ')} value=${original.organ} />
        <${Row} label=${t('reference.key')} value=${html`<code>${original.key}</code>`} />
        <${TextRow} label=${t('reference.title')} value=${form.title} onInput=${(v) => set({ title: v })} />
        <${TextRow} label=${t('reference.unit')} value=${form.unit} onInput=${(v) => set({ unit: v })} autocapitalize="off" />
      <//>
      <${Group} title=${t('reference.section.range')}
        footer=${badNumber ? t('reference.number_invalid') : badRange ? t('reference.range_invalid') : t('reference.range_hint')}>
        <${TextRow} label=${t('reference.min')} value=${form.min} inputmode="decimal" placeholder="—" onInput=${(v) => set({ min: v })} />
        <${TextRow} label=${t('reference.max')} value=${form.max} inputmode="decimal" placeholder="—" onInput=${(v) => set({ max: v })} />
        <${Row} label=${t('reference.preview')} value=${badNumber || badRange ? '—' : formatRange(min, max, form.unit.trim())} />
      <//>
      <${Group} title=${t('reference.section.applies')} footer=${badAge ? t('reference.age_invalid') : t('reference.applies_hint')}>
        <${SelectRow} label=${t('patient.gender')} value=${form.gender} onChange=${(v) => set({ gender: v })}
          options=${[{ value: '', label: t('reference.any_gender') }, { value: 'Ж', label: t('reference.female') }, { value: 'М', label: t('reference.male') }]} />
        <${TextRow} label=${t('reference.min_age')} value=${form.minAge} inputmode="numeric" placeholder="—" onInput=${(v) => set({ minAge: v.replace(/\D/g, '') })} />
        <${TextRow} label=${t('reference.max_age')} value=${form.maxAge} inputmode="numeric" placeholder="—" onInput=${(v) => set({ maxAge: v.replace(/\D/g, '') })} />
      <//>
      <${Group} title=${t('reference.section.source')}>
        <${TextRow} label=${t('reference.source')} value=${form.source} onInput=${(v) => set({ source: v })} />
        <${TextRow} label=${t('reference.page')} value=${form.sourcePage} onInput=${(v) => set({ sourcePage: v })} autocapitalize="off" />
        <${AreaRow} label=${t('reference.note')} value=${form.note} onInput=${(v) => set({ note: v })} />
      <//>
      <${Group} title=${t('reference.variants')} footer=${t('reference.variants_hint')}>
        ${variants.map((r) => html`<${Row} key=${r.key} label=${appliesText(r) || t('reference.for_all')} value=${rangeText(r)} chevron
          onClick=${() => replace('/ref/' + encodeURIComponent(r.key))} />`)}
        <${Row} label=${t('reference.add_variant')} icon="plus" accent onClick=${addVariant} />
      <//>
      ${seed && html`
        <${Group} footer=${t('reference.default_value') + ' ' + seedSummary(seed)}>
          <${Row} label=${t('reference.restore_default')} icon="refresh" accent onClick=${restore} />
        <//>`}
      ${!seed && html`
        <${Group}>
          <${Row} label=${t('reference.delete')} icon="trash" destructive onClick=${removeVariant} />
        <//>`}
    <//>`;
}

// ---------- Экспорт / импорт ----------

export function ExchangeScreen() {
  useData();
  const fileInput = useRef(null);
  const [pending, setPending] = useState(null);
  const refs = sortedRefs();
  const fileName = 'uzi-references-' + fileDate() + '.json';
  const makeBlob = () => new Blob([exportJSON(refs)], { type: 'application/json' });

  const share = async () => {
    const result = await shareFile(makeBlob(), fileName, fileName);
    if (result === 'downloaded') toast(t('exchange.export_done'));
  };
  const download = () => { downloadBlob(makeBlob(), fileName); toast(t('exchange.export_done')); };

  const onFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const parsed = parseExport(await readFileText(file));
      setPending({ parsed, fileName: file.name });
    } catch (err) {
      alertDialog(errText(err), t('exchange.bad_format'));
    }
  };

  return html`
    <${Screen} title=${t('references.import_export')} backTo="/refs">
      <${Group} title=${t('exchange.export')} footer=${t('exchange.export_footer')}>
        <${Row} label=${t('exchange.items_count')} value=${String(refs.length)} />
        <${Row} label=${t('exchange.export_share')} icon="share" accent onClick=${share} />
        <${Row} label=${t('exchange.export_download')} icon="download" accent onClick=${download} />
      <//>
      <${Group} title=${t('exchange.import_header')} footer=${t('exchange.import_footer')}>
        <${Row} label=${t('exchange.import')} icon="doc" accent onClick=${() => fileInput.current && fileInput.current.click()} />
      <//>
      <input ref=${fileInput} type="file" accept=".json,application/json" class="hidden-input" onChange=${onFile} />
      ${pending && html`<${DiffSheet} parsed=${pending.parsed} fileName=${pending.fileName}
        onClose=${() => setPending(null)}
        onApplied=${() => { setPending(null); toast(t('diff.applied')); }} />`}
    <//>`;
}

function DiffSheet({ parsed, fileName, onClose, onApplied }) {
  useData();
  const [strategy, setStrategy] = useState('merge');
  const [busy, setBusy] = useState(false);
  const diff = diffItems(sortedRefs().map(toItem), parsed.items);
  const effect = diffEffect(diff, strategy);
  const hasChanges = effect.add + effect.update + effect.remove > 0;

  const apply = async () => {
    if (busy || !hasChanges) return;
    setBusy(true);
    try {
      await snapshot('Перед импортом: ' + fileName);
      await applyImport(parsed.items, strategy);
      await snapshot('После импорта: ' + fileName);
      onApplied();
    } catch (e) {
      setBusy(false);
      alertDialog(errText(e), t('common.error'));
    }
  };

  const count = (label, n, cls) => html`<${Row} label=${label} value=${html`<b class=${n > 0 ? cls : 'muted'}>${n}</b>`} />`;
  const entryRow = (e, item) => html`<${Row} key=${e.key} label=${(item.organ ? item.organ + ' — ' : '') + item.title}
    sub=${formatRange(item.minValue, item.maxValue, item.unit) + (item.source ? ' · ' + item.source : '')} />`;
  const exported = parsed.exportedAt && !Number.isNaN(new Date(parsed.exportedAt).getTime())
    ? new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(parsed.exportedAt))
    : (parsed.exportedAt || '—');

  return html`
    <${Sheet} title=${t('diff.title')} onClose=${onClose} onDone=${apply} doneLabel=${t('diff.apply')} doneDisabled=${!hasChanges || busy}>
      <${Group}>
        <${Row} label=${t('diff.file')} value=${fileName} />
        <${Row} label=${t('diff.exported_at')} value=${exported} />
        <${Row} label=${t('diff.items_in_file')} value=${String(parsed.items.length)} />
      <//>
      <${Group} title=${t('diff.strategy')} footer=${t('strategy.' + strategy + '_hint')}>
        <div class="row">
          <${Segmented} value=${strategy} onChange=${setStrategy} options=${[
            { value: 'merge', label: t('strategy.merge') },
            { value: 'skipExisting', label: t('strategy.skipExisting') },
            { value: 'replaceAll', label: t('strategy.replaceAll') },
          ]} />
        </div>
      <//>
      <${Group} title=${t('diff.summary')}>
        ${count(t('diff.added'), diff.added.length, 'c-green')}
        ${count(t('diff.changed'), diff.changed.length, 'c-orange')}
        ${count(t('diff.missing'), diff.removed.length, 'c-red')}
        ${count(t('diff.unchanged'), diff.unchanged.length, 'muted')}
      <//>
      <${Group} title=${t('diff.effect')} footer=${t('diff.snapshot_note')}>
        ${count(t('diff.will_add'), effect.add, 'c-green')}
        ${count(t('diff.will_update'), effect.update, 'c-orange')}
        ${count(t('diff.will_remove'), effect.remove, 'c-red')}
      <//>
      ${diff.added.length > 0 && html`<${Group} title=${t('diff.added')}>${diff.added.map((e) => entryRow(e, e.incoming))}<//>`}
      ${diff.changed.length > 0 && html`
        <${Group} title=${t('diff.changed')}>
          ${diff.changed.map((e) => html`
            <div key=${e.key} class="row stack">
              <span class="row-label">${(e.incoming.organ ? e.incoming.organ + ' — ' : '') + e.incoming.title}</span>
              ${e.changes.map((c) => html`<span key=${c.field} class="change">
                <span class="muted">${t(c.field)}:</span> <s>${c.old}</s> → <b>${c.new}</b>
              </span>`)}
            </div>`)}
        <//>`}
      ${diff.removed.length > 0 && html`
        <${Group} title=${t('diff.missing')} footer=${t('diff.missing_hint')}>${diff.removed.map((e) => entryRow(e, e.current))}<//>`}
    <//>`;
}

// ---------- История версий ----------

export function VersionsScreen() {
  const d = useData();
  const versions = Array.from(d.versions.values()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const fmt = (v) => new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(v));

  const create = async () => {
    const name = await promptDialog({ title: t('versions.create'), message: t('versions.create_hint'), placeholder: t('versions.note') });
    if (name === null) return;
    try {
      await snapshot(name.trim() || 'Ручной снимок');
      toast(t('common.saved'));
    } catch (e) {
      alertDialog(errText(e), t('common.error'));
    }
  };

  const restore = async (v) => {
    const ok = await confirmDialog({
      title: t('versions.restore_confirm'), message: (v.note || '—') + '\n' + fmt(v.createdAt),
      confirmLabel: t('versions.restore'),
    });
    if (!ok) return;
    try {
      await restoreVersion(v);
      toast(t('versions.restored'));
    } catch (e) {
      alertDialog(errText(e), t('common.error'));
    }
  };

  const del = async (v) => {
    const ok = await confirmDialog({ title: t('versions.delete_confirm'), message: v.note || fmt(v.createdAt), confirmLabel: t('common.delete'), destructive: true });
    if (ok) await remove('versions', v.id);
  };

  return html`
    <${Screen} title=${t('references.versions')} backTo="/refs"
      right=${html`<${NavButton} icon="plus" label=${t('versions.create')} onClick=${create} />`}>
      ${versions.length === 0
        ? html`<${Empty} icon="clock" text=${t('versions.empty')} />`
        : html`<${Group} footer=${t('versions.footer')}>
            ${versions.map((v) => html`
              <div key=${v.id} class="row appt-row">
                <button class="appt-main" onClick=${() => restore(v)}>
                  <span class="row-main">
                    <span class="row-label">${v.note || '—'}</span>
                    <span class="row-sub">${fmt(v.createdAt)} · ${t('versions.items_count', v.itemCount)}</span>
                  </span>
                </button>
                <button class="del-btn quiet" onClick=${() => del(v)} aria-label=${t('common.delete')}><${Icon} name="trash" size=${18} /></button>
              </div>`)}
          <//>`}
    <//>`;
}
