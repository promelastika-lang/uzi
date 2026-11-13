// Системы УЗИ, поля протоколов, нормы, шаблоны.
// Медицинские названия — по-русски (протокол по форме 557н всегда на русском).
import { parseNum, fmtNum } from './util.js';

export const SYSTEMS = [
  { id: 'abdomen', title: 'Органы брюшной полости', short: 'ОБП' },
  { id: 'kidneys', title: 'Почки', short: 'Почки' },
  { id: 'lymphNodes', title: 'Лимфатические узлы', short: 'Л/у' },
  { id: 'bladder', title: 'Мочевой пузырь', short: 'МП' },
  { id: 'prostate', title: 'Предстательная железа', short: 'Простата' },
  { id: 'thyroid', title: 'Щитовидная железа', short: 'ЩЖ' },
];
export const systemById = (id) => SYSTEMS.find((s) => s.id === id);

export const LYMPH_GROUPS = [
  { id: 'retroperitoneal', title: 'Забрюшинные' },
  { id: 'submandibular', title: 'Подчелюстные' },
  { id: 'submental', title: 'Подбородочные' },
  { id: 'cervical', title: 'Шейные' },
  { id: 'supraclavicular', title: 'Надключичные' },
  { id: 'subclavian', title: 'Подключичные' },
  { id: 'axillary', title: 'Подмышечные' },
  { id: 'inguinal', title: 'Паховые' },
];

export const STATUS = {
  below: { symbol: '↓', title: 'ниже нормы', color: '#1a59cc' },
  normal: { symbol: '✓', title: 'норма', color: '#1a8033' },
  above: { symbol: '↑', title: 'выше нормы', color: '#cc2619' },
  unknown: { symbol: '', title: '', color: '#666666' },
};

export const DESCRIPTION_KEY = 'description';

// ---------- Справочник норм (стартовые значения) ----------
// Значения справочные — врач сверяет их с первоисточниками и правит в приложении.

export const SEED_VERSION = 1;
const IZR = 'Изранов В.А. Лекция «Нормы УЗИ» (shopdon.ru)';
const EFS = 'EFSUMB Course Book, 2nd ed.';
const EFS_ESR = 'EFSUMB Course Book, 2nd ed.; ESR';
const SUM = 'Сводные УЗИ-нормы';

const S = (key, organ, title, unit, minValue, maxValue, source, sourcePage, note) =>
  ({ key, organ, title, unit, minValue, maxValue, source, sourcePage: sourcePage || '', note: note || '' });

export const REFERENCE_SEED = [
  S('liver_right_kvr', 'Печень', 'Правая доля, КВР', 'мм', null, 150, IZR, '2022', 'Косой вертикальный размер'),
  S('liver_right_thick', 'Печень', 'Правая доля, толщина', 'мм', null, 125, IZR, '2022'),
  S('liver_left_kkr', 'Печень', 'Левая доля, ККР', 'мм', null, 100, IZR, '2022', 'Кранио-каудальный размер'),
  S('liver_left_thick', 'Печень', 'Левая доля, толщина', 'мм', null, 60, IZR, '2022'),
  S('portal_vein', 'Печень', 'Воротная вена, диаметр', 'мм', null, 13, IZR, '2022'),

  S('gb_length', 'Жёлчный пузырь', 'Длина', 'мм', 50, 100, IZR, '2022', 'Натощак'),
  S('gb_width', 'Жёлчный пузырь', 'Ширина', 'мм', null, 35, IZR, '2022', 'Натощак'),
  S('gb_wall', 'Жёлчный пузырь', 'Толщина стенки', 'мм', null, 3, IZR, '2022'),
  S('cbd', 'Жёлчный пузырь', 'Холедох, диаметр', 'мм', null, 6, IZR, '2022', 'После холецистэктомии может быть шире'),

  S('panc_head', 'Поджелудочная железа', 'Головка', 'мм', 15, 25, EFS, '2024'),
  S('panc_body', 'Поджелудочная железа', 'Тело', 'мм', null, 20, EFS, '2024'),
  S('panc_tail', 'Поджелудочная железа', 'Хвост', 'мм', null, 25, EFS, '2024'),
  S('panc_duct', 'Поджелудочная железа', 'Вирсунгов проток', 'мм', null, 3, EFS, '2024'),

  S('spleen_length', 'Селезёнка', 'Длина', 'мм', null, 120, EFS_ESR, '2024; ecr2021/C-10075', 'Более 130 мм — спленомегалия'),
  S('spleen_thick', 'Селезёнка', 'Толщина', 'мм', null, 50, EFS_ESR, '2024; ecr2021/C-10075'),
  S('spleen_vein', 'Селезёнка', 'Селезёночная вена', 'мм', null, 10, EFS, '2024'),

  S('kidney_length', 'Почки', 'Длина', 'мм', 100, 120, IZR, '2022'),
  S('kidney_width', 'Почки', 'Ширина', 'мм', 50, 60, IZR, '2022'),
  S('kidney_thick', 'Почки', 'Толщина', 'мм', 40, 50, IZR, '2022'),
  S('kidney_paren', 'Почки', 'Паренхима', 'мм', 15, 25, IZR, '2022'),
  S('kidney_pelvis', 'Почки', 'Лоханка (ПЗР)', 'мм', null, 10, IZR, '2022', 'Зависит от наполнения мочевого пузыря'),

  S('ln_short', 'Лимфатические узлы', 'Короткая ось', 'мм', null, 10, IZR, '2022', 'Для большинства групп'),
  S('ln_short_inguinal', 'Лимфатические узлы', 'Паховые, короткая ось', 'мм', null, 15, IZR, '2022'),
  S('ln_solbiati', 'Лимфатические узлы', 'Индекс Солбиати (Д/КО)', '', 2, null, IZR, '2022', 'Меньше 2 — округлая форма узла'),

  S('bladder_wall', 'Мочевой пузырь', 'Толщина стенки', 'мм', null, 4, SUM, '', 'При достаточном наполнении'),
  S('bladder_residual', 'Мочевой пузырь', 'Остаточная моча', 'мл', null, 50, SUM, ''),

  S('prostate_width', 'Предстательная железа', 'Поперечный размер', 'мм', 27, 43, SUM, ''),
  S('prostate_ap', 'Предстательная железа', 'Передне-задний размер', 'мм', 16, 23, SUM, ''),
  S('prostate_length', 'Предстательная железа', 'Верхне-нижний размер', 'мм', 24, 41, SUM, ''),
  S('prostate_volume', 'Предстательная железа', 'Объём', 'мл', null, 25, SUM, '', 'Д × Ш × ПЗР × 0,52'),

  S('thyroid_lobe_length', 'Щитовидная железа', 'Доля, длина', 'мм', 40, 60, SUM, ''),
  S('thyroid_lobe_width', 'Щитовидная железа', 'Доля, ширина', 'мм', 15, 20, SUM, ''),
  S('thyroid_lobe_thick', 'Щитовидная железа', 'Доля, толщина', 'мм', 13, 18, SUM, ''),
  S('thyroid_isthmus', 'Щитовидная железа', 'Перешеек', 'мм', null, 5, SUM, ''),
  S('thyroid_volume', 'Щитовидная железа', 'Общий объём (Ж)', 'мл', null, 18, SUM, '', 'Объём доли = Д × Ш × Т × 0,479'),
  S('thyroid_volume_m', 'Щитовидная железа', 'Общий объём (М)', 'мл', null, 25, SUM, '', 'Объём доли = Д × Ш × Т × 0,479'),
];

export const seedItem = (key) => REFERENCE_SEED.find((i) => i.key === key);

// ---------- Нормы: оценка и форматирование ----------

export function evaluate(ref, value) {
  if (!ref || value === null || value === undefined) return 'unknown';
  const min = ref.minValue, max = ref.maxValue;
  if ((min === null || min === undefined) && (max === null || max === undefined)) return 'unknown';
  if (min !== null && min !== undefined && value < min) return 'below';
  if (max !== null && max !== undefined && value > max) return 'above';
  return 'normal';
}

export function formatRange(min, max, unit) {
  const u = unit ? ' ' + unit : '';
  const hasMin = min !== null && min !== undefined;
  const hasMax = max !== null && max !== undefined;
  if (hasMin && hasMax) return `${fmtNum(min)}–${fmtNum(max)}${u}`;
  if (hasMin) return `≥ ${fmtNum(min)}${u}`;
  if (hasMax) return `≤ ${fmtNum(max)}${u}`;
  return '—';
}

export const rangeText = (ref) => formatRange(ref.minValue, ref.maxValue, ref.unit);
export const sourceText = (ref) => [ref.source, ref.sourcePage].filter((x) => x && String(x).trim()).join(', ');
export const hasRange = (ref) => ref && ((ref.minValue !== null && ref.minValue !== undefined) || (ref.maxValue !== null && ref.maxValue !== undefined));

// ---------- Расчёты ----------

const num = (f, k) => parseNum(f[k]);
const round1 = (v) => Math.round(v * 10) / 10;
function ellipsoid(f, a, b, c, factor) {
  const x = num(f, a), y = num(f, b), z = num(f, c);
  if (!(x > 0 && y > 0 && z > 0)) return null;
  return round1((x * y * z * factor) / 1000); // мм³ → мл
}
function ratio(f, a, b) {
  const x = num(f, a), y = num(f, b);
  if (!(x > 0 && y > 0)) return null;
  return round1(x / y);
}
const thyroidLobe = (f, p) => num(f, p + '_volume') ?? ellipsoid(f, p + '_length', p + '_width', p + '_thick', 0.479);

// ---------- Конфигурация протоколов 6 систем ----------
// field: { key, title, unit, ref?, refMale?, compute? }
// section: { title, fields, option? } — option: показывается только при включённом подпункте

const F = (key, title, unit, ref, extra) => ({ key, title, unit, ref: ref || null, ...(extra || {}) });

const kidneyFields = (p) => [
  F(p + '_length', 'Длина', 'мм', 'kidney_length'),
  F(p + '_width', 'Ширина', 'мм', 'kidney_width'),
  F(p + '_thick', 'Толщина', 'мм', 'kidney_thick'),
  F(p + '_paren', 'Паренхима', 'мм', 'kidney_paren'),
  F(p + '_pelvis', 'Лоханка (ПЗР)', 'мм', 'kidney_pelvis'),
];

const thyroidLobeFields = (p) => [
  F(p + '_length', 'Длина', 'мм', 'thyroid_lobe_length'),
  F(p + '_width', 'Ширина', 'мм', 'thyroid_lobe_width'),
  F(p + '_thick', 'Толщина', 'мм', 'thyroid_lobe_thick'),
  F(p + '_volume', 'Объём доли', 'мл', null, { compute: (f) => ellipsoid(f, p + '_length', p + '_width', p + '_thick', 0.479) }),
];

export const SYSTEM_CONFIG = {
  abdomen: {
    options: [
      { key: 'liver', title: 'Печень', defaultOn: true },
      { key: 'gallbladder', title: 'Жёлчный пузырь', defaultOn: true },
      { key: 'pancreas', title: 'Поджелудочная железа', defaultOn: true },
      { key: 'spleen', title: 'Селезёнка', defaultOn: true },
    ],
    sections: [
      { title: 'Печень', option: 'liver', fields: [
        F('liver_right_kvr', 'Правая доля, КВР', 'мм', 'liver_right_kvr'),
        F('liver_right_thick', 'Правая доля, толщина', 'мм', 'liver_right_thick'),
        F('liver_left_kkr', 'Левая доля, ККР', 'мм', 'liver_left_kkr'),
        F('liver_left_thick', 'Левая доля, толщина', 'мм', 'liver_left_thick'),
        F('portal_vein', 'Воротная вена', 'мм', 'portal_vein'),
      ] },
      { title: 'Жёлчный пузырь', option: 'gallbladder', fields: [
        F('gb_length', 'Длина', 'мм', 'gb_length'),
        F('gb_width', 'Ширина', 'мм', 'gb_width'),
        F('gb_wall', 'Толщина стенки', 'мм', 'gb_wall'),
        F('cbd', 'Холедох', 'мм', 'cbd'),
      ] },
      { title: 'Поджелудочная железа', option: 'pancreas', fields: [
        F('panc_head', 'Головка', 'мм', 'panc_head'),
        F('panc_body', 'Тело', 'мм', 'panc_body'),
        F('panc_tail', 'Хвост', 'мм', 'panc_tail'),
        F('panc_duct', 'Вирсунгов проток', 'мм', 'panc_duct'),
      ] },
      { title: 'Селезёнка', option: 'spleen', fields: [
        F('spleen_length', 'Длина', 'мм', 'spleen_length'),
        F('spleen_thick', 'Толщина', 'мм', 'spleen_thick'),
        F('spleen_vein', 'Селезёночная вена', 'мм', 'spleen_vein'),
      ] },
    ],
  },
  kidneys: {
    options: [
      { key: 'right', title: 'Правая почка', defaultOn: true },
      { key: 'left', title: 'Левая почка', defaultOn: true },
    ],
    sections: [
      { title: 'Правая почка', option: 'right', fields: kidneyFields('rk') },
      { title: 'Левая почка', option: 'left', fields: kidneyFields('lk') },
    ],
  },
  lymphNodes: {
    options: LYMPH_GROUPS.map((g) => ({ key: g.id, title: g.title, defaultOn: false })),
    sections: LYMPH_GROUPS.map((g) => ({
      title: g.title,
      option: g.id,
      fields: [
        F(g.id + '_length', 'Длина', 'мм'),
        F(g.id + '_short', 'Короткая ось', 'мм', g.id === 'inguinal' ? 'ln_short_inguinal' : 'ln_short'),
        F(g.id + '_solbiati', 'Индекс Солбиати', '', 'ln_solbiati', { compute: (f) => ratio(f, g.id + '_length', g.id + '_short') }),
      ],
    })),
  },
  bladder: {
    options: [{ key: 'residual', title: 'Остаточная моча', defaultOn: false }],
    sections: [
      { title: 'Мочевой пузырь', fields: [
        F('bl_length', 'Длина', 'мм'),
        F('bl_width', 'Ширина', 'мм'),
        F('bl_height', 'Передне-задний размер', 'мм'),
        F('bl_volume', 'Объём', 'мл', null, { compute: (f) => ellipsoid(f, 'bl_length', 'bl_width', 'bl_height', 0.52) }),
        F('bl_wall', 'Толщина стенки', 'мм', 'bladder_wall'),
      ] },
      { title: 'Остаточная моча', option: 'residual', fields: [
        F('res_length', 'Длина', 'мм'),
        F('res_width', 'Ширина', 'мм'),
        F('res_height', 'Передне-задний размер', 'мм'),
        F('res_volume', 'Объём остаточной мочи', 'мл', 'bladder_residual', { compute: (f) => ellipsoid(f, 'res_length', 'res_width', 'res_height', 0.52) }),
      ] },
    ],
  },
  prostate: {
    options: [{ key: 'seminal', title: 'Семенные пузырьки', defaultOn: false }],
    sections: [
      { title: 'Предстательная железа', fields: [
        F('pr_width', 'Поперечный размер', 'мм', 'prostate_width'),
        F('pr_ap', 'Передне-задний размер', 'мм', 'prostate_ap'),
        F('pr_length', 'Верхне-нижний размер', 'мм', 'prostate_length'),
        F('pr_volume', 'Объём', 'мл', 'prostate_volume', { compute: (f) => ellipsoid(f, 'pr_width', 'pr_ap', 'pr_length', 0.52) }),
      ] },
      { title: 'Семенные пузырьки', option: 'seminal', fields: [
        F('sv_right', 'Правый, толщина', 'мм'),
        F('sv_left', 'Левый, толщина', 'мм'),
      ] },
    ],
  },
  thyroid: {
    options: [{ key: 'parathyroid', title: 'Паращитовидные железы', defaultOn: false }],
    sections: [
      { title: 'Правая доля', fields: thyroidLobeFields('tr') },
      { title: 'Левая доля', fields: thyroidLobeFields('tl') },
      { title: 'Перешеек и общий объём', fields: [
        F('isthmus', 'Перешеек', 'мм', 'thyroid_isthmus'),
        F('total_volume', 'Общий объём', 'мл', 'thyroid_volume', {
          refMale: 'thyroid_volume_m',
          compute: (f) => {
            const r = thyroidLobe(f, 'tr'), l = thyroidLobe(f, 'tl');
            if (r === null && l === null) return null;
            return round1((r || 0) + (l || 0));
          },
        }),
      ] },
      { title: 'Паращитовидные железы', option: 'parathyroid', fields: [
        F('pt_size', 'Наибольший размер', 'мм'),
      ] },
    ],
  },
};

export const refKeyFor = (field, gender) => (gender === 'М' && field.refMale ? field.refMale : field.ref);

export function isOptionOn(systemId, block, key) {
  if (block.options && key in block.options) return !!block.options[key];
  const opt = SYSTEM_CONFIG[systemId].options.find((o) => o.key === key);
  return opt ? !!opt.defaultOn : false;
}

export function visibleSections(block) {
  const cfg = SYSTEM_CONFIG[block.system];
  if (!cfg) return [];
  return cfg.sections.filter((s) => !s.option || isOptionOn(block.system, block, s.option));
}

/** Строки результатов — общие для экрана и PDF. */
export function blockResults(block, refs, gender) {
  const out = [];
  for (const section of visibleSections(block)) {
    const lines = [];
    for (const field of section.fields) {
      const refKey = refKeyFor(field, gender);
      const ref = refKey ? refs.get(refKey) || null : null;
      const raw = String((block.fields || {})[field.key] ?? '').trim();
      const v = parseNum(raw);
      if (v !== null) {
        lines.push({ title: field.title, value: fmtNum(v), unit: field.unit, status: evaluate(ref, v), ref, computed: false });
      } else if (raw) {
        lines.push({ title: field.title, value: raw, unit: '', status: 'unknown', ref, computed: false });
      } else if (field.compute) {
        const c = field.compute(block.fields || {});
        if (c !== null && c !== undefined) {
          lines.push({ title: field.title, value: fmtNum(c), unit: field.unit, status: evaluate(ref, c), ref, computed: true });
        }
      }
    }
    if (lines.length === 0 && !section.option) continue;
    out.push({ title: section.title, lines });
  }
  return out;
}

export function emptyBlock(systemId) {
  return { system: systemId, enabled: false, fields: {}, options: {} };
}

/** Все 6 блоков в постоянном порядке. */
export function normalizeBlocks(blocks) {
  const list = blocks || [];
  return SYSTEMS.map((s) => {
    const b = list.find((x) => x.system === s.id);
    return b ? { system: s.id, enabled: !!b.enabled, fields: { ...(b.fields || {}) }, options: { ...(b.options || {}) } } : emptyBlock(s.id);
  });
}

export const enabledBlocks = (appt) => normalizeBlocks(appt.blocks).filter((b) => b.enabled);

export function studyTitle(appt) {
  const names = enabledBlocks(appt).map((b) => systemById(b.system).title);
  return names.length ? 'УЗИ: ' + names.join(', ') : '—';
}
export const studyShort = (appt) => enabledBlocks(appt).map((b) => systemById(b.system).short).join(', ');

export function filledCount(block) {
  return Object.entries(block.fields || {}).filter(([k, v]) => k !== DESCRIPTION_KEY && String(v).trim()).length;
}

export function patientName(p) {
  if (!p) return '—';
  const n = [p.surname, p.name, p.middleName].filter(Boolean).join(' ');
  return n || '—';
}

export function birthText(p) {
  if (!p || !p.birthDay || !p.birthMonth || !p.birthYear) return '—';
  const z = (n, l = 2) => String(n).padStart(l, '0');
  return `${z(p.birthDay)}/${z(p.birthMonth)}/${z(p.birthYear, 4)}`;
}

// ---------- Шаблоны заключений ----------

export const DEFAULT_TEMPLATES = [
  ['ОБП — норма', 'Эхографических признаков патологии органов брюшной полости не выявлено.', 'abdomen'],
  ['Диффузные изменения печени', 'Эхографические признаки диффузных изменений паренхимы печени.', 'abdomen'],
  ['Диффузные изменения поджелудочной', 'Эхографические признаки диффузных изменений поджелудочной железы.', 'abdomen'],
  ['Почки — норма', 'Эхографических признаков патологии почек не выявлено.', 'kidneys'],
  ['Лимфоузлы — норма', 'Лимфатические узлы исследованных групп не увеличены, структура сохранена.', 'lymphNodes'],
  ['Мочевой пузырь — норма', 'Эхографических признаков патологии мочевого пузыря не выявлено.', 'bladder'],
  ['Простата — норма', 'Эхографических признаков патологии предстательной железы не выявлено.', 'prostate'],
  ['Увеличение простаты', 'Эхографические признаки увеличения предстательной железы.', 'prostate'],
  ['ЩЖ — норма', 'Эхографических признаков патологии щитовидной железы не выявлено.', 'thyroid'],
  ['Узел ЩЖ', 'Эхографические признаки узлового образования ___ доли щитовидной железы (TI-RADS ___).', 'thyroid'],
  ['Рекомендация', 'Рекомендована консультация лечащего врача.', ''],
];

export const PROBE_PRESETS = [
  'Конвексный, 2–5 МГц',
  'Линейный, 5–12 МГц',
  'Микроконвексный, 4–8 МГц',
  'Внутриполостной, 4–9 МГц',
];
