// PDF-протокол по форме Приказа Минздрава РФ № 557н (Приложение № 7).
// A4, автоперенос строк и разрыв страниц делает pdfmake; шрифт Roboto (с кириллицей) встроен.
import { STATUS, DESCRIPTION_KEY, systemById, blockResults, enabledBlocks, studyTitle, rangeText, sourceText, hasRange, birthText } from './models.js';
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

export function pdfFileName(appt) {
  const safe = String(appt.protocolNumber || '').replace(/[^0-9A-Za-z_-]/g, '');
  return 'UZI_protocol_' + (safe || fileDate(appt.date)) + '.pdf';
}

const GRAY = '#555555';
const BLANK = '______________________________________________';

const labeled = (label, value, extra) => ({
  text: [{ text: label + ': ', bold: true }, value && String(value).trim() ? String(value).trim() : '—'],
  margin: [0, 0, 0, 3],
  ...(extra || {}),
});

const section = (title) => [
  { text: title, bold: true, fontSize: 11, margin: [0, 10, 0, 2], headlineLevel: 1 },
  { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 511, y2: 0, lineWidth: 0.5, lineColor: '#bbbbbb' }], margin: [0, 0, 0, 5] },
];

function genderText(g) {
  if (g === 'М') return 'мужской';
  if (g === 'Ж') return 'женский';
  return '';
}

export function buildDocDefinition(appt, patient, refs, settings) {
  const gender = (patient && patient.gender) || 'Ж';
  const number = appt.protocolNumber || '—';
  const content = [];

  // 1. Шапка
  content.push(labeled('Наименование медицинской организации', (settings.orgName || '').trim() || BLANK));
  content.push(labeled('Адрес местонахождения', (settings.orgAddress || '').trim() || BLANK));

  // 2. Заголовок
  content.push({ text: 'ПРОТОКОЛ УЛЬТРАЗВУКОВОГО ИССЛЕДОВАНИЯ', bold: true, fontSize: 16, alignment: 'center', margin: [0, 16, 0, 10] });

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

  for (const block of blocks) {
    const system = systemById(block.system);
    content.push({ text: system.title, bold: true, fontSize: 11, margin: [0, 4, 0, 3], headlineLevel: 2 });
    const sections = blockResults(block, refs, gender);
    let anyComputed = false;

    for (const sec of sections) {
      if (sec.title !== system.title) {
        content.push({ text: sec.title, bold: true, margin: [8, 2, 0, 2], headlineLevel: 2 });
      }
      if (!sec.lines.length) {
        content.push({ text: 'измерения не вносились', color: GRAY, margin: [18, 0, 0, 2] });
      }
      for (const line of sec.lines) {
        const parts = [
          { text: line.title + ': ' },
          { text: line.value + (line.unit ? ' ' + line.unit : '') + (line.computed ? '*' : ''), bold: true },
        ];
        if (line.status !== 'unknown') {
          parts.push({ text: '   ' + STATUS[line.status].title, bold: true, color: STATUS[line.status].color });
        }
        if (hasRange(line.ref)) {
          parts.push({ text: '   (реф. ' + rangeText(line.ref) + ')', fontSize: 9, color: GRAY });
          if (!used.has(line.ref.key)) used.set(line.ref.key, line.ref);
        }
        if (line.computed) anyComputed = true;
        content.push({ text: parts, margin: [18, 0, 0, 2] });
      }
    }

    const description = String((block.fields || {})[DESCRIPTION_KEY] || '').trim();
    if (description) content.push(labeled('Описание', description, { margin: [8, 3, 0, 3] }));
    if (anyComputed) content.push({ text: '* — рассчитано автоматически', fontSize: 9, color: GRAY, margin: [8, 1, 0, 2] });
    content.push({ text: '', margin: [0, 0, 0, 4] });
  }

  // 8. Заключение
  content.push(...section('ЗАКЛЮЧЕНИЕ'));
  content.push({ text: (appt.conclusion || '').trim() || '—', margin: [0, 0, 0, 3] });

  // 10. Дата, врач, подпись — сразу после заключения, чтобы подпись не уезжала на отдельный лист.
  content.push({
    unbreakable: true,
    margin: [0, 16, 0, 0],
    stack: [
      labeled('Дата', fmtDate(appt.date)),
      labeled('Фамилия, имя, отчество медицинского работника', appt.doctorName),
      labeled('Подпись', '____________________', { margin: [0, 8, 0, 0] }),
    ],
  });

  // 9. Справочно: использованные нормы и источники (мелко, в конце, по органам).
  if (used.size) {
    content.push(...section('СПРАВОЧНО: ИСПОЛЬЗОВАННЫЕ НОРМЫ'));
    const list = Array.from(used.values()).sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0));
    const groups = [];
    for (const r of list) {
      const src = sourceText(r);
      let g = groups.find((x) => x.organ === r.organ && x.src === src);
      if (!g) { g = { organ: r.organ, src, items: [] }; groups.push(g); }
      g.items.push(`${r.title} ${rangeText(r)}`);
    }
    for (const g of groups) {
      content.push({
        text: [
          { text: g.organ + ': ', bold: true },
          g.items.join('; ') + '.' + (g.src ? ' Источник: ' + g.src + '.' : ''),
        ],
        fontSize: 9, color: GRAY, margin: [0, 0, 0, 2.5],
      });
    }
    content.push({ text: 'Нормы справочные и не заменяют клинические рекомендации.', fontSize: 9, color: GRAY, margin: [0, 2, 0, 0] });
  }

  return {
    pageSize: 'A4',
    pageMargins: [42, 42, 42, 48],
    info: { title: 'Протокол УЗИ № ' + number, creator: 'УЗИ-протоколы' },
    defaultStyle: { font: 'Roboto', fontSize: 10, lineHeight: 1.15 },
    footer: (page, pages) => ({
      text: `Протокол УЗИ № ${number} · стр. ${page} из ${pages}`,
      alignment: 'right', fontSize: 9, color: '#888888', margin: [42, 16, 42, 0],
    }),
    // Заголовок не должен остаться последней строкой на странице.
    pageBreakBefore: (node, following) => {
      if (node.headlineLevel === 1) return following.length <= 1; // заголовок раздела + линия под ним
      if (node.headlineLevel === 2) return following.length === 0; // название системы или органа
      return false;
    },
    content,
  };
}

export async function buildProtocolPDF(appt, patient, refs, settings) {
  await loadPdfMake();
  const doc = buildDocDefinition(appt, patient, refs, settings);
  return new Promise((resolve, reject) => {
    try {
      window.pdfMake.createPdf(doc).getBlob((blob) => resolve(blob));
    } catch (e) {
      reject(e);
    }
  });
}
