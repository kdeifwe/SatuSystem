export const KB_CATEGORIES = [
  'product',
  'faq',
  'procedure',
  'contact',
  'file',
  'other',
] as const;

export type KBCategory = (typeof KB_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<KBCategory, string> = {
  product: 'Продукты',
  faq: 'Вопросы и ответы',
  procedure: 'Процедуры',
  contact: 'Контакты',
  file: 'Файлы',
  other: 'Другое',
};

export const CATEGORY_COLORS: Record<KBCategory, string> = {
  product: 'blue',
  faq: 'green',
  procedure: 'purple',
  contact: 'orange',
  file: 'gray',
  other: 'yellow',
};

export function normalizeCategory(value: unknown): KBCategory {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'qa') return 'faq';
  if (normalized === 'questions' || normalized === 'questions_answers') return 'faq';
  if (normalized === 'contacts' || normalized === 'contacts') return 'contact';
  if (normalized === 'product' || normalized === 'faq' || normalized === 'procedure' || normalized === 'contact' || normalized === 'file' || normalized === 'other') {
    return normalized as KBCategory;
  }
  return 'other';
}

export function buildCategorizationPrompt(chunks: string[]): string {
  return `Ты классификатор контента для базы знаний компании.
Тебе дан список фрагментов текста. Для каждого фрагмента определи категорию.

Категории:
- product: информация о товарах, услугах, тарифах, ценах, характеристиках, составе
- faq: вопросы и ответы, типичные возражения, разъяснения
- procedure: пошаговые инструкции, алгоритмы, регламенты, правила использования
- contact: контактные данные, адреса, телефоны, email, часы работы, реквизиты
- file: упоминания документов, прайс-листов, каталогов, ссылки на файлы
- other: всё, что не подходит ни под одну из категорий выше

Ответь ТОЛЬКО в формате JSON-массива категорий, без пояснений.
Количество элементов в ответе должно совпадать с количеством фрагментов.

Пример входных данных (3 фрагмента):
["Цена на продукт А составляет 15000 тенге", "Как оформить возврат?", "г. Алматы, ул. Абая 10"]

Пример ответа:
["product", "faq", "contact"]

Фрагменты для категоризации (${chunks.length} штук):
${JSON.stringify(chunks)}

Ответ (только JSON-массив):`;
}

export function buildCategoriesSummary(categories: KBCategory[]): Record<KBCategory, number> {
  const summary = {} as Record<KBCategory, number>;
  for (const category of KB_CATEGORIES) {
    summary[category] = 0;
  }
  for (const category of categories) {
    summary[category] = (summary[category] ?? 0) + 1;
  }
  return summary;
}
