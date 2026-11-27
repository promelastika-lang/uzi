// PDF: протокол по форме Приказа Минздрава РФ № 557н (Приложение № 7), история пациента, отчёт за период.
// A4, автоперенос строк и разрыв страниц делает pdfmake; шрифт Roboto (с кириллицей) встроен.
import {
  STATUS, DESCRIPTION_KEY, DISCLAIMER, systemById, blockResults, enabledBlocks, studyTitle, studyShort,
  rangeText, sourceText, hasRange, birthText, appliesText, patientName, patientInfo, buildRefIndex, bmi, translit,
} from './models.js';
import { fmtDate, fmtDateTime, fileDate } from './util.js';

let loading = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Не удалось загрузить ' + src + '. Проверьте интернет при первом запуске.'));
    document.head.appendChild(s);
  });
}

/** Подгружает pdfmake и шрифты (около 2 МБ) только когда нужен PDF. */
export function loadPdfMake() {
  if (window.pdfMake && window.pdfMake.vfs) return Promise.resolve();
  if (!loading) {
    loading = loadScript('vendor/pdfmake.min.js')
      .then(() => loadScript('vendor/vfs_fonts.js'))
      .catch((e) => { loading = null; throw e; });
  }
  return loading;
}

/** Protocol_Ivanov_2026-11-21.pdf */
export function protocolFileName(appt, patient, ext = 'pdf') {
  const surname = translit((patient && patient.surname) || '') || 'patient';
  return `Protocol_${surname}_${fileDate(appt.date)}.${ext}`;
}

const GRAY = '#555555';
const BLANK = '______________________________________________';

/** Общие настройки вёрстки. scale — множитель размера шрифта из настроек (0,85–1,2). */
function makeKit(scale) {
  const k = Math.min(1.2, Math.max(0.85, Number(scale) || 1));
  const sz = (n) => Math.round(n * k * 10) / 10;
  const labeled = (label, value, extra) => ({
    text: [{ text: label + ': ', bold: true }, value && String(value).trim() ? String(value).trim() : '—'],
    margin: [0, 0, 0, 3],
    ...(extra || {}),
  });
  const section = (title) => [
    { text: title, bold: true, fontSize: sz(11), margin: [0, 10, 0, 2], headlineLevel: 1 },
    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 511, y2: 0, lineWidth: 0.5, lineColor: '#bbbbbb' }], margin: [0, 0, 0, 5] },
  ];
  const page = (title, footerText, content, extra) => ({
    pageSize: 'A4',
    pageMargins: [42, 42, 42, 48],
    info: { title, creator: 'УЗИ-протоколы' },
    defaultStyle: { font: 'Roboto', fontSize: sz(10), lineHeight: 1.15 },
    footer: (pageNo, pages) => ({
      text: `${footerText} · стр. ${pageNo} из ${pages}`,
      alignment: 'right', fontSize: sz(9), color: '#888888', margin: [42, 16, 42, 0],
    }),
    // Заголовок не должен остаться последней строкой на странице.
    pageBreakBefore: (node, following) => {
      if (node.headlineLevel === 1) return following.length <= 1; // заголовок раздела + линия под ним
      if (node.headlineLevel === 2) return following.length === 0; // название системы или органа
      return false;
    },
    content,
    ...(extra || {}),
  });
  return { sz, labeled, section, page };
}

function genderText(g) {
  if (g === 'М') return 'мужской';
  if (g === 'Ж') return 'женский';
  return '';
}

/** Строки измерений одной системы — общие для протокола и истории пациента. */
function systemContent(kit, block, index, info, used) {
  const { sz, labeled } = kit;
  const out = [];
  const system = systemById(block.system);
  out.push({ text: system.title, bold: true, fontSize: sz(11), margin: [0, 4, 0, 3], headlineLevel: 2 });
  const sections = blockResults(block, index, info);
  let anyComputed = false;

  for (const sec of sections) {
    if (sec.title !== system.title) out.push({ text: sec.title, bold: true, margin: [8, 2, 0, 2], headlineLevel: 2 });
    if (!sec.lines.length) out.push({ text: 'измерения не вносились', color: GRAY, margin: [18, 0, 0, 2] });
    for (const line of sec.lines) {
      const parts = [
        { text: line.title + ': ' },
        { text: line.value + (line.unit ? ' ' + line.unit : '') + (line.computed ? '*' : ''), bold: true },
      ];
      if (line.status !== 'unknown') {
        parts.push({ text: '   ' + STATUS[line.status].title, bold: true, color: STATUS[line.status].color });
      }
      if (hasRange(line.ref)) {
        parts.push({ text: '   (реф. ' + rangeText(line.ref) + ')', fontSize: sz(9), color: GRAY });
        if (used && !used.has(line.ref.key)) used.set(line.ref.key, line.ref);
      }
      if (line.computed) anyComputed = true;
      out.push({ text: parts, margin: [18, 0, 0, 2] });
    }
  }

  const description = String((block.fields || {})[DESCRIPTION_KEY] || '').trim();
  if (description) out.push(labeled('Описание', description, { margin: [8, 3, 0, 3] }));
  if (anyComputed) out.push({ text: '* — рассчитано автоматически', fontSize: sz(9), color: GRAY, margin: [8, 1, 0, 2] });
  out.push({ text: '', margin: [0, 0, 0, 4] });
  return out;
}

/** Список использованных норм с источниками, по органам. */
function sourcesContent(kit, used) {
  const { sz, section } = kit;
  const out = [...section('СПРАВОЧНО: ИСПОЛЬЗОВАННЫЕ НОРМЫ')];
  const list = Array.from(used.values()).sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0));
  const groups = [];
  for (const r of list) {
    const src = sourceText(r);
    let g = groups.find((x) => x.organ === r.organ && x.src === src);
    if (!g) { g = { organ: r.organ, src, items: [] }; groups.push(g); }
    const who = appliesText(r);
    g.items.push(`${r.title}${who ? ' (' + who + ')' : ''} ${rangeText(r)}`);
  }
  for (const g of groups) {
    out.push({
      text: [
        { text: g.organ + ': ', bold: true },
        g.items.join('; ') + '.' + (g.src ? ' Источник: ' + g.src + '.' : ''),
      ],
      fontSize: sz(9), color: GRAY, margin: [0, 0, 0, 2.5],
    });
  }
  out.push({ text: 'Нормы справочные и не заменяют клинические рекомендации.', fontSize: sz(9), color: GRAY, margin: [0, 2, 0, 0] });
  return out;
}

/**
 * Протокол УЗИ.
 * options: { clinic, showLogo, showSources, showSignature, fontScale }
 */
export function buildDocDefinition(appt, patient, refs, options = {}) {
  const kit = makeKit(options.fontScale);
  const { sz, labeled, section, page } = kit;
  const clinic = options.clinic || null;
  const index = buildRefIndex(refs);
  const info = patientInfo(patient, appt.date);
  const number = appt.protocolNumber || '—';
  const content = [];

  // 1. Шапка: реквизиты клиники или пустые строки для заполнения от руки
  const header = [
    labeled('Наименование медицинской организации', (clinic && clinic.name) || BLANK),
    labeled('Адрес местонахождения', (clinic && clinic.address) || BLANK),
  ];
  const contacts = clinic ? [clinic.phone && 'тел. ' + clinic.phone, clinic.email].filter(Boolean).join(' · ') : '';
  if (contacts) header.push({ text: contacts, color: GRAY, margin: [0, 0, 0, 3] });
  const logo = options.showLogo !== false && clinic && /^data:image\/(png|jpeg);base64,/.test(clinic.logo || '') ? clinic.logo : null;
  if (logo) {
    content.push({ columns: [{ image: logo, fit: [64, 64], width: 72 }, { stack: header, width: '*' }], columnGap: 8 });
  } else {
    content.push(...header);
  }

  // 2. Заголовок
  content.push({ text: 'ПРОТОКОЛ УЛЬТРАЗВУКОВОГО ИССЛЕДОВАНИЯ', bold: true, fontSize: sz(16), alignment: 'center', margin: [0, 16, 0, 10] });

  // 3. Номер, дата и время
  content.push(labeled('Номер протокола', appt.protocolNumber));
  content.push(labeled('Дата и время проведения исследования', fmtDateTime(appt.date)));

  // 4. Данные о пациенте
  content.push(...section('ДАННЫЕ О ПАЦИЕНТЕ'));
  content.push(labeled('Фамилия', patient && patient.surname));
  content.push(labeled('Имя', patient && patient.name));
  content.push(labeled('Отчество (при наличии)', patient && patient.middleName));
  content.push(labeled('Пол', genderText(patient && patient.gender)));
  content.push(labeled('Дата рождения (ДД/ММ/ГГГГ)', birthText(patient)));
  content.push(labeled('Номер медицинской карты', patient && patient.cardNumber));

  // 5. Технические особенности
  content.push(...section('ТЕХНИЧЕСКИЕ ОСОБЕННОСТИ'));
  content.push(labeled('Название ультразвуковой системы', appt.usSystemName));
  content.push(labeled('Тип датчика и диапазон частот', appt.probeType));

  // 6. Характеристики исследования
  content.push(...section('ХАРАКТЕРИСТИКИ ИССЛЕДОВАНИЯ'));
  content.push(labeled('Название исследования', studyTitle(appt)));
  content.push(labeled('Значимая информация', appt.significantInfo));
  content.push(labeled('Дополнительная информация', appt.additionalInfo));
  content.push(labeled('Осложнения', appt.complications));

  // 7. Подробное описание результатов с измерениями
  content.push(...section('ПОДРОБНОЕ ОПИСАНИЕ РЕЗУЛЬТАТОВ С ИЗМЕРЕНИЯМИ'));
  const used = new Map();
  const blocks = enabledBlocks(appt);
  if (!blocks.length) content.push({ text: 'Системы не выбраны.', color: GRAY });
  for (const block of blocks) content.push(...systemContent(kit, block, index, info, used));

  // 8. Заключение и предупреждение
  const conclusion = (appt.conclusion || '').trim();
  content.push(...section('ЗАКЛЮЧЕНИЕ'));
  content.push({ text: conclusion || '—', margin: [0, 0, 0, 4] });
  content.push({ text: DISCLAIMER, italics: true, fontSize: sz(9), color: GRAY, margin: [0, 0, 0, 3] });

  // 10. Дата, врач, подпись — сразу после заключения, чтобы подпись не уезжала на отдельный лист.
  const closing = [
    labeled('Дата', fmtDate(appt.date)),
    labeled('Фамилия, имя, отчество медицинского работника', appt.doctorName),
  ];
  if (options.showSignature !== false) closing.push(labeled('Подпись', '____________________', { margin: [0, 8, 0, 0] }));
  content.push({ unbreakable: true, margin: [0, 14, 0, 0], stack: closing });

  // 9. Справочно: использованные нормы и источники (если включено в настройках).
  if (options.showSources !== false && used.size) content.push(...sourcesContent(kit, used));

  const extra = {};
  // Водяной знак, пока заключение не написано.
  if (!conclusion) extra.watermark = { text: 'ЧЕРНОВИК', color: '#888888', opacity: 0.16, bold: true };
  return page('Протокол УЗИ № ' + number, 'Протокол УЗИ № ' + number, content, extra);
}

/** История пациента: все исследования подряд, свежие сверху. */
export function buildHistoryDoc(patient, studies, refs, options = {}) {
  const kit = makeKit(options.fontScale);
  const { sz, labeled, section, page } = kit;
  const index = buildRefIndex(refs);
  const content = [];
  content.push({ text: 'ИСТОРИЯ УЛЬТРАЗВУКОВЫХ ИССЛЕДОВАНИЙ', bold: true, fontSize: sz(15), alignment: 'center', margin: [0, 0, 0, 10] });
  content.push(labeled('Пациент', patientName(patient)));
  content.push(labeled('Пол', genderText(patient && patient.gender)));
  content.push(labeled('Дата рождения (ДД/ММ/ГГГГ)', birthText(patient)));
  content.push(labeled('Номер медицинской карты', patient && patient.cardNumber));
  const massIndex = patient ? bmi(patient.height, patient.weight) : null;
  if (patient && (patient.height || patient.weight)) {
    content.push(labeled('Рост / вес', [patient.height ? patient.height + ' см' : '', patient.weight ? patient.weight + ' кг' : ''].filter(Boolean).join(', ')
      + (massIndex ? ` (ИМТ ${String(massIndex).replace('.', ',')})` : '')));
  }
  content.push(labeled('Всего исследований', String(studies.length)));

  for (const appt of studies) {
    content.push(...section(`${fmtDateTime(appt.date)} — протокол № ${appt.protocolNumber || '—'}`));
    const info = patientInfo(patient, appt.date);
    const blocks = enabledBlocks(appt);
    if (!blocks.length) content.push({ text: 'Системы не выбраны.', color: GRAY });
    for (const block of blocks) content.push(...systemContent(kit, block, index, info, null));
    content.push(labeled('Заключение', appt.conclusion));
    if (appt.doctorName) content.push(labeled('Врач', appt.doctorName));
  }
  content.push({ text: DISCLAIMER, italics: true, fontSize: sz(9), color: GRAY, margin: [0, 12, 0, 0] });
  return page('История исследований: ' + patientName(patient), 'История: ' + patientName(patient), content);
}

/** Отчёт за период: таблица исследований. rows — [{ appt, patient }]. */
export function buildPeriodDoc(title, rows, summary, options = {}) {
  const kit = makeKit(options.fontScale);
  const { sz, labeled, page } = kit;
  const content = [];
  content.push({ text: 'ОТЧЁТ ОБ УЛЬТРАЗВУКОВЫХ ИССЛЕДОВАНИЯХ', bold: true, fontSize: sz(15), alignment: 'center', margin: [0, 0, 0, 4] });
  content.push({ text: title, alignment: 'center', margin: [0, 0, 0, 10] });
  content.push(labeled('Исследований', String(summary.studies)));
  content.push(labeled('Пациентов', String(summary.patients)));
  content.push(labeled('Систем', String(summary.systems)));
  const cell = (text, extra) => ({ text: text || '—', fontSize: sz(8.5), ...(extra || {}) });
  const body = [[
    cell('Дата', { bold: true }), cell('Пациент', { bold: true }), cell('Системы', { bold: true }),
    cell('Заключение', { bold: true }), cell('Врач', { bold: true }),
  ]];
  for (const { appt, patient } of rows) {
    body.push([
      cell(fmtDateTime(appt.date)), cell(patientName(patient)), cell(studyShort(appt)),
      cell((appt.conclusion || '').trim()), cell(appt.doctorName),
    ]);
  }
  if (rows.length) {
    content.push({
      margin: [0, 10, 0, 0],
      table: { headerRows: 1, widths: [62, 100, 50, '*', 70], body },
      layout: { hLineWidth: () => 0.5, vLineWidth: () => 0, hLineColor: () => '#bbbbbb', paddingTop: () => 4, paddingBottom: () => 4 },
    });
  } else {
    content.push({ text: 'За период исследований нет.', color: GRAY, margin: [0, 10, 0, 0] });
  }
  return page('Отчёт: ' + title, 'Отчёт: ' + title, content);
}

/** Построить PDF из описания документа. */
export async function renderPdf(doc) {
  await loadPdfMake();
  return new Promise((resolve, reject) => {
    try {
      window.pdfMake.createPdf(doc).getBlob((blob) => resolve(blob));
    } catch (e) {
      reject(e);
    }
  });
}

export const buildProtocolPDF = (appt, patient, refs, options) => renderPdf(buildDocDefinition(appt, patient, refs, options));
