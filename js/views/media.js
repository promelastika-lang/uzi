// Фото, видео и аудио: блок в записи, просмотр, диктофон, галерея пациента, QR-код.
import { html, useState, useEffect, useRef } from '../../vendor/standalone.module.js';
import { useData, put, removeMedia } from '../db.js';
import { t } from '../i18n.js';
import {
  Screen, Group, Row, TextRow, Sheet, Icon, Empty, confirmDialog, alertDialog, toast,
} from '../ui.js';
import { patientName } from '../models.js';
import { patientStudies, activeClinic } from '../ops.js';
import {
  prepareFiles, audioItem, storeItems, mediaOfAppointment, mediaOfPatient, mediaBlob, fmtSize, fmtDuration,
  qrText, qrMatrix, MAX_PER_PICK,
} from '../media.js';
import { fmtDate, fmtDateTime, shareFile, downloadBlob } from '../util.js';

const errText = (e) => String((e && e.message) || e);

/** Имя файла для отправки: фото после сжатия всегда JPEG. */
function shareName(meta) {
  const base = String(meta.fileName || meta.kind).replace(/\.[^.]+$/, '') || meta.kind;
  if (meta.kind === 'photo') return base + '.jpg';
  return meta.fileName || base;
}

// ---------- Блок медиа ----------

/**
 * Сетка файлов с кнопками «добавить» и «записать».
 * items — описания; getBlob(meta) — содержимое; onAddItems(подготовленные) — сохранить; onRemove, onCaption.
 */
export function MediaBlock({ title, footer, items, getBlob, onAddItems, onRemove, onCaption }) {
  const fileInput = useRef(null);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [recording, setRecording] = useState(false);

  const onFiles = async (e) => {
    const files = e.target.files;
    if (!files || !files.length) return;
    setBusy(true);
    try {
      const { items: prepared, errors } = await prepareFiles(files);
      if (prepared.length) await onAddItems(prepared);
      if (files.length > MAX_PER_PICK) errors.push(t('media.too_many', MAX_PER_PICK));
      if (errors.length) alertDialog(errors.join('\n'), t('media.some_failed'));
    } catch (err) {
      alertDialog(errText(err), t('common.error'));
    } finally {
      e.target.value = '';
      setBusy(false);
    }
  };

  const saveAudio = async (blob, duration) => {
    setRecording(false);
    try {
      await onAddItems([await audioItem(blob, duration)]);
      toast(t('media.audio_saved'));
    } catch (err) {
      alertDialog(errText(err), t('common.error'));
    }
  };

  return html`
    <${Group} title=${title || t('media.title')} footer=${footer || t('media.footer')}>
      ${items.length > 0 && html`
        <div class="row media-grid-row">
          <div class="media-grid">
            ${items.map((m) => html`
              <button key=${m.id} class="media-tile" onClick=${() => setViewing(m)} aria-label=${m.caption || m.fileName || m.kind}>
                ${m.thumb
                  ? html`<img src=${m.thumb} alt="" />`
                  : html`<span class="media-icon"><${Icon} name=${m.kind === 'audio' ? 'mic' : m.kind === 'video' ? 'video' : 'photo'} size=${28} /></span>`}
                ${m.kind !== 'photo' && html`<span class="media-badge">${m.kind === 'video' ? '▶ ' : ''}${fmtDuration(m.duration)}</span>`}
                ${m.caption && html`<span class="media-caption">${m.caption}</span>`}
              </button>`)}
          </div>
        </div>`}
      <${Row} label=${busy ? t('media.processing') : t('media.add')} icon="photo" accent onClick=${() => !busy && fileInput.current && fileInput.current.click()} />
      <${Row} label=${t('media.record')} icon="mic" accent onClick=${() => setRecording(true)} />
    <//>
    <input ref=${fileInput} type="file" accept="image/*,video/*" multiple class="hidden-input" onChange=${onFiles} />
    ${viewing && html`<${MediaViewer} meta=${viewing} getBlob=${getBlob} onClose=${() => setViewing(null)}
      onRemove=${async (m) => { await onRemove(m); setViewing(null); }} onCaption=${onCaption} />`}
    ${recording && html`<${AudioRecorderSheet} onSave=${saveAudio} onClose=${() => setRecording(false)} />`}`;
}

/** Медиа сохранённой записи или пациента: всё сразу пишется в базу. */
export function SavedMedia({ link, items, title, footer }) {
  return html`<${MediaBlock} title=${title} footer=${footer} items=${items}
    getBlob=${(m) => mediaBlob(m)}
    onAddItems=${(prepared) => storeItems(prepared, link)}
    onRemove=${(m) => removeMedia([m.id])}
    onCaption=${(m, caption) => put('mediaMeta', { ...m, caption })} />`;
}

/** Медиа новой, ещё не сохранённой записи: держим в памяти до сохранения. */
export function PendingMedia({ pending, setPending }) {
  return html`<${MediaBlock} items=${pending.map((p) => p.meta)} footer=${t('media.pending_footer')}
    getBlob=${async (m) => { const p = pending.find((x) => x.meta.id === m.id); return p ? new Blob([p.buffer], { type: m.mime }) : null; }}
    onAddItems=${async (prepared) => setPending((prev) => [...prev, ...prepared])}
    onRemove=${async (m) => setPending((prev) => prev.filter((x) => x.meta.id !== m.id))}
    onCaption=${async (m, caption) => setPending((prev) => prev.map((x) => (x.meta.id === m.id ? { ...x, meta: { ...x.meta, caption } } : x)))} />`;
}

// ---------- Просмотр ----------

function MediaViewer({ meta, getBlob, onClose, onRemove, onCaption }) {
  const [url, setUrl] = useState('');
  const [blob, setBlob] = useState(null);
  const [failed, setFailed] = useState(false);
  const [caption, setCaption] = useState(meta.caption || '');

  useEffect(() => {
    let objectUrl = '';
    let alive = true;
    getBlob(meta).then((b) => {
      if (!alive) return;
      if (!b) { setFailed(true); return; }
      objectUrl = URL.createObjectURL(b);
      setBlob(b);
      setUrl(objectUrl);
    }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [meta.id]);

  const done = async () => {
    if (caption.trim() !== (meta.caption || '')) await onCaption(meta, caption.trim());
    onClose();
  };
  const share = async () => {
    if (!blob) return;
    const result = await shareFile(blob, shareName(meta), shareName(meta));
    if (result === 'downloaded') toast(t('exchange.export_done'));
  };
  const remove = async () => {
    const ok = await confirmDialog({ title: t('media.delete_confirm'), confirmLabel: t('common.delete'), destructive: true });
    if (ok) await onRemove(meta);
  };

  return html`
    <${Sheet} title=${t('media.kind.' + meta.kind)} onClose=${onClose} closeLabel=${t('common.close')} onDone=${done}>
      <div class="media-view">
        ${failed && html`<${Empty} icon="warn" text=${t('media.missing')} />`}
        ${!failed && !url && html`<p class="muted">${t('media.loading')}</p>`}
        ${url && meta.kind === 'photo' && html`<img src=${url} alt=${meta.caption || ''} />`}
        ${url && meta.kind === 'video' && html`<video src=${url} controls playsinline preload="metadata"></video>`}
        ${url && meta.kind === 'audio' && html`<audio src=${url} controls preload="metadata"></audio>`}
      </div>
      <${Group} footer=${[fmtDateTime(meta.createdAt), fmtSize(meta.size), meta.kind !== 'photo' && fmtDuration(meta.duration)].filter(Boolean).join(' · ')}>
        <${TextRow} label=${t('media.caption')} value=${caption} onInput=${setCaption} placeholder=${t('media.caption_placeholder')} />
      <//>
      <${Group}>
        <${Row} label=${t('media.share')} icon="share" accent onClick=${share} />
        <${Row} label=${t('media.delete')} icon="trash" destructive onClick=${remove} />
      <//>
    <//>`;
}

// ---------- Диктофон ----------

function pickAudioMime() {
  if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
  for (const type of ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg']) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

function AudioRecorderSheet({ onSave, onClose }) {
  const supported = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  const [phase, setPhase] = useState('idle'); // idle | recording | done
  const [seconds, setSeconds] = useState(0);
  const [result, setResult] = useState(null); // { blob, url, duration }
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const startedRef = useRef(0);
  const fileInput = useRef(null);

  const stopStream = () => {
    clearInterval(timerRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  // При закрытии окна запись останавливается и микрофон освобождается.
  useEffect(() => () => {
    try { if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop(); } catch (e) { /* уже остановлен */ }
    stopStream();
  }, []);
  useEffect(() => () => { if (result && result.url) URL.revokeObjectURL(result.url); }, [result]);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickAudioMime();
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks = [];
      recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      recorder.onstop = () => {
        const duration = (Date.now() - startedRef.current) / 1000;
        const blob = new Blob(chunks, { type: recorder.mimeType || mime || 'audio/mp4' });
        stopStream();
        setResult({ blob, url: URL.createObjectURL(blob), duration });
        setPhase('done');
      };
      recorderRef.current = recorder;
      startedRef.current = Date.now();
      setSeconds(0);
      recorder.start();
      timerRef.current = setInterval(() => setSeconds(Math.floor((Date.now() - startedRef.current) / 1000)), 250);
      setPhase('recording');
    } catch (e) {
      stopStream();
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      alertDialog(denied ? t('audio.denied') : errText(e), t('audio.error'));
    }
  };
  const stop = () => {
    try { recorderRef.current.stop(); } catch (e) { /* ignore */ }
  };
  const again = () => { setResult(null); setPhase('idle'); setSeconds(0); };

  const onFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const duration = await new Promise((resolve) => {
      const a = document.createElement('audio');
      const u = URL.createObjectURL(file);
      a.onloadedmetadata = () => { URL.revokeObjectURL(u); resolve(Number.isFinite(a.duration) ? a.duration : 0); };
      a.onerror = () => { URL.revokeObjectURL(u); resolve(0); };
      a.src = u;
    });
    onSave(file, duration);
  };

  return html`
    <${Sheet} title=${t('audio.title')} onClose=${onClose}
      onDone=${phase === 'done' ? () => onSave(result.blob, result.duration) : null} doneLabel=${t('common.save')}>
      <div class="recorder">
        <div class=${'recorder-time' + (phase === 'recording' ? ' live' : '')}>${fmtDuration(phase === 'done' ? result.duration : seconds)}</div>
        ${!supported && html`<p class="muted">${t('audio.unsupported')}</p>`}
        ${supported && phase === 'idle' && html`<button class="record-btn" onClick=${start} aria-label=${t('audio.start')}><span></span></button>`}
        ${phase === 'recording' && html`<button class="record-btn stop" onClick=${stop} aria-label=${t('audio.stop')}><span></span></button>`}
        ${phase === 'done' && html`<audio src=${result.url} controls preload="metadata"></audio>`}
        <p class="muted small">${phase === 'idle' ? t('audio.hint_idle') : phase === 'recording' ? t('audio.hint_recording') : t('audio.hint_done')}</p>
      </div>
      <${Group} footer=${t('audio.dictation_hint')}>
        ${phase === 'done' && html`<${Row} label=${t('audio.again')} icon="refresh" accent onClick=${again} />`}
        ${phase !== 'recording' && html`<${Row} label=${t('audio.pick_file')} icon="doc" accent onClick=${() => fileInput.current && fileInput.current.click()} />`}
      <//>
      <input ref=${fileInput} type="file" accept="audio/*" class="hidden-input" onChange=${onFile} />
    <//>`;
}

// ---------- Готовый файл: поделиться или скачать ----------

export function FileSheet({ title, file, hint, onClose }) {
  const canShare = !!(navigator.canShare && navigator.canShare({ files: [new File([file.blob], file.filename, { type: file.blob.type })] }));
  const share = async () => {
    const result = await shareFile(file.blob, file.filename, file.filename);
    if (result === 'downloaded') toast(t('exchange.export_done'));
  };
  return html`
    <${Sheet} title=${title} onClose=${onClose} closeLabel=${t('common.close')}>
      <${Group} footer=${hint}>
        <${Row} label=${file.filename} sub=${fmtSize(file.blob.size)} icon="doc" />
      <//>
      <${Group}>
        ${canShare && html`<${Row} label=${t('media.share')} icon="share" accent onClick=${share} />`}
        <${Row} label=${t('exchange.export_download')} icon="download" accent
          onClick=${() => { downloadBlob(file.blob, file.filename); toast(t('exchange.export_done')); }} />
      <//>
    <//>`;
}

// ---------- QR-код протокола ----------

export function QrSheet({ appt, patient, onClose }) {
  const text = qrText(appt, patient, activeClinic());
  const [matrix, setMatrix] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    qrMatrix(text).then((m) => { if (alive) setMatrix(m); }).catch((e) => { if (alive) setError(errText(e)); });
    return () => { alive = false; };
  }, [text]);

  let svg = null;
  if (matrix) {
    const quiet = 4;
    const total = matrix.size + quiet * 2;
    let d = '';
    for (let r = 0; r < matrix.size; r++) {
      for (let c = 0; c < matrix.size; c++) {
        if (matrix.dark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
      }
    }
    svg = html`<svg class="qr" viewBox=${`0 0 ${total} ${total}`} role="img" aria-label=${t('qr.title')} shape-rendering="crispEdges">
      <rect width=${total} height=${total} fill="#ffffff" /><path d=${d} fill="#000000" />
    </svg>`;
  }

  return html`
    <${Sheet} title=${t('qr.title')} onClose=${onClose} closeLabel=${t('common.close')}>
      <div class="qr-box">
        ${error && html`<p class="c-red">${error}</p>`}
        ${!error && !matrix && html`<p class="muted">${t('media.loading')}</p>`}
        ${svg}
      </div>
      <${Group} title=${t('qr.content')} footer=${t('qr.hint')}>
        <div class="row stack"><span class="row-text small">${text}</span></div>
      <//>
    <//>`;
}

// ---------- Галерея пациента ----------

export function PatientMediaScreen({ id }) {
  const d = useData();
  const patient = d.patients.get(id);
  if (!patient) {
    return html`<${Screen} title=${t('media.title')} backTo="/"><${Empty} icon="person" text=${t('patient.none')} /><//>`;
  }
  const all = mediaOfPatient(id);
  const own = all.filter((m) => !m.appointmentId);
  const studies = patientStudies(id).filter((a) => mediaOfAppointment(a.id).length > 0);

  return html`
    <${Screen} title=${patientName(patient)} backTo=${'/patient/' + id}>
      <${SavedMedia} link=${{ appointmentId: null, patientId: id }} items=${own}
        title=${t('media.patient_own')} footer=${t('media.patient_footer')} />
      ${studies.map((a) => html`
        <${SavedMedia} key=${a.id} link=${{ appointmentId: a.id, patientId: id }} items=${mediaOfAppointment(a.id)}
          title=${t('media.of_study', fmtDate(a.date))} footer=${' '} />`)}
    <//>`;
}
