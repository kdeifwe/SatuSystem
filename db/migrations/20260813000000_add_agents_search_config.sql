-- add_agents_search_config.sql

BEGIN;

-- add column for per-agent search configuration
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS search_config jsonb DEFAULT '{}'::jsonb;

-- populate the bilingual_term_map for the agents that currently depend on the hardcoded rules
-- (do not apply to all agents)
UPDATE agents
SET search_config = jsonb_set(coalesce(search_config, '{}'::jsonb), '{bilingual_term_map}',
$$[
  {
    "pattern": "^(қанша|ия\\s+қанша|баға|стоимост|цен|сколько\\s+стоит|нарх)",
    "query_ru": "стоимость обучения",
    "query_kk": "оқу құны",
    "variants": ["цена курса"]
  },
  {
    "pattern": "(қанша|ия\\s+қанша|баға|стоимост|цен|сколько\\s+стоит|нарх)",
    "query_ru": "стоимость обучения",
    "query_kk": "оқу құны",
    "variants": ["цена курса"]
  },
  {
    "pattern": "^(қанша\\s+уақыт|ұзақты|срок|длительност|длится|месяц|ай)",
    "query_ru": "срок обучения",
    "query_kk": "оқу ұзақтығы",
    "variants": ["длительность курса","курс ұзақтығы"]
  },
  {
    "pattern": "(қанша\\s+уақыт|ұзақты|срок|длительност|длится|месяц|ай)",
    "query_ru": "срок обучения",
    "query_kk": "оқу ұзақтығы",
    "variants": ["длительность курса","курс ұзақтығы"]
  },
  {
    "pattern": "^(пән|пәндер|предмет|что\\s+изучают|қай\\s+пәндер)",
    "query_ru": "изучаемые предметы",
    "query_kk": "қай пәндер",
    "variants": ["предметы курса"]
  },
  {
    "pattern": "(пән|пәндер|предмет|что\\s+изучают|қай\\s+пәндер)",
    "query_ru": "изучаемые предметы",
    "query_kk": "қай пәндер",
    "variants": ["предметы курса"]
  },
  {
    "pattern": "^(тіркел|регистрац|как\\s+записаться|как\\s+зарегистрироваться|как\\s+поступить|записаться)",
    "query_ru": "регистрация на курс",
    "query_kk": "курсқа тіркелу"
  },
  {
    "pattern": "(тіркел|регистрац|как\\s+записаться|как\\s+зарегистрироваться|как\\s+поступить|записаться)",
    "query_ru": "регистрация на курс",
    "query_kk": "курсқа тіркелу"
  },
  {
    "pattern": "^(не\\s+ұсынасыз|что\\s+продаёте|услуга|қызмет)",
    "query_ru": "продукт и услуги",
    "query_kk": "өнім мен қызметтер"
  },
  {
    "pattern": "(не\\s+ұсынасыз|что\\s+продаёте|услуга|қызмет)",
    "query_ru": "продукт и услуги",
    "query_kk": "өнім мен қызметтер"
  },
  {
    "pattern": "(smart|программа)",
    "query_ru": "Программа SMART",
    "query_kk": "SMART бағдарламасы"
  }
]$$::jsonb, true)
WHERE id = '1469465d-418d-44ac-9751-a304666e6dc4';

COMMIT;
