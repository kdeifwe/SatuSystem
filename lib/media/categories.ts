export const MEDIA_CATEGORIES = [
  { id: 'product_photo', label: 'Фото товара', description: 'Классические фотографии товаров: карточки, ракурсные снимки.' },
  { id: 'price_list', label: 'Прайс-лист', description: 'Таблицы или PDF с ценами и прайсами.' },
  { id: 'certificate', label: 'Сертификат', description: 'Сертификаты соответствия, лицензии, гарантии.' },
  { id: 'catalog', label: 'Каталог', description: 'Каталоги товаров/услуг, брошюры.' },
  { id: 'video_demo', label: 'Видео-демо', description: 'Демонстрационные видеоролики или обзоры.' },
  { id: 'presentation', label: 'Презентация', description: 'Презентации (PDF, PPT) и маркет материалы.' },
  { id: 'location_map', label: 'Карта местоположения', description: 'Скриншоты/файлы карт с указанием локаций.' },
  { id: 'other', label: 'Другое', description: 'Прочие файлы и медиа.' },
] as const;

export type MediaCategoryId = typeof MEDIA_CATEGORIES[number]['id'];

export type MediaCategory = typeof MEDIA_CATEGORIES[number];

export default MEDIA_CATEGORIES;
