INSERT INTO conversation_examples (niche_id, technique_id, situation_text, agent_reply, outcome, channel) VALUES
(
  (SELECT id FROM niche_profiles WHERE slug = 'home-appliances'),
  (SELECT id FROM sales_techniques WHERE technique_name = 'Feature-Advantage-Benefit'),
  'Клиент: А чем ваш холодильник лучше обычного?',
  'Отличный вопрос! У нас инверторный компрессор — это значит, он работает тише на 40% обычных моделей. Представьте: ночью тишина, дети спят, а холодильник не гудит. Это комфорт, который ощущается каждый день.',
  'lead_converted',
  'whatsapp'
),
(
  (SELECT id FROM niche_profiles WHERE slug = 'real-estate'),
  (SELECT id FROM sales_techniques WHERE technique_name = 'Implication Question (Вопрос о последствиях)'),
  'Клиент: Думаю, подожду до осени, может цены упадут.',
  'Понимаю. А если цены на жильё в этом районе вырастут ещё на 8-10% к осени, как это повлияет на ваш бюджет? Вы сможете купить ту же площадь или придётся смотреть меньше?',
  'appointment_set',
  'telegram'
),
(
  (SELECT id FROM niche_profiles WHERE slug = 'b2b-services'),
  (SELECT id FROM sales_techniques WHERE technique_name = 'Teach (Обучи клиента)'),
  'Клиент: Нам и так нормально, зачем менять процессы?',
  'Большинство компаний так думают, пока не посчитают. Мы проанализировали: при 200 заявках в день ручная обработка даёт 12% ошибок. Это 24 недовольных клиента ежедневно. Стоимость одного ухода — в среднем 15 000₽. Получается, "нормально" обходится в 360 000₽ в день.',
  'appointment_set',
  'web'
),
(
  (SELECT id FROM niche_profiles WHERE slug = 'automotive'),
  (SELECT id FROM sales_techniques WHERE technique_name = 'Feel-Felt-Found (Понимаю-Чувствовал-Нашёл)'),
  'Клиент: Дорого, у конкурента дешевле на 200 тысяч.',
  'Я вас прекрасно понимаю, 200 тысяч — серьёзная разница. Многие наши клиенты сначала тоже смотрели на цену, но потом посчитали: переплата окупается за 2 года за счёт гарантии 5 лет, низкого расхода топлива и высокой остаточной стоимости при перепродаже.',
  'lead_converted',
  'whatsapp'
),
(
  (SELECT id FROM niche_profiles WHERE slug = 'saas-it'),
  (SELECT id FROM sales_techniques WHERE technique_name = 'Need-Payoff Question (Вопрос о выгоде)'),
  'Клиент: Не уверен, что автоматизация нам нужна.',
  'Если автоматизация сэкономит вашей команде по 10 часов в неделю каждому менеджеру, во что вы вложите это время? Больше продаж? Развитие клиентов? Или это позволит сократить переработки?',
  'appointment_set',
  'telegram'
),
(
  (SELECT id FROM niche_profiles WHERE slug = 'home-appliances'),
  (SELECT id FROM sales_techniques WHERE technique_name = 'Alternative Close (Альтернативное закрытие)'),
  'Клиент: Ладно, беру. Как доставите?',
  'Отличный выбор! Что удобнее: доставка завтра до 14:00 с подъёмом на этаж, или послезавтра с бесплатной установкой мастером?',
  'lead_converted',
  'whatsapp'
)
ON CONFLICT DO NOTHING;
