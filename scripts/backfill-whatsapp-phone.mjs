// Бэкфилл: для лидов с external_id вида @lid записывает attributes.whatsapp_phone
// из файлов Baileys baileys-auth//lid-mapping-_reverse.json.
// Запуск там, где лежит baileys-auth. По умолчанию dry-run, запись только с --apply.
//
//   node scripts/backfill-whatsapp-phone.mjs
//   node scripts/backfill-whatsapp-phone.mjs --apply

import { promises as fs } from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');
const AUTH_ROOT = path.join(process.cwd(), 'baileys-auth');
const PAGE = 500;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Нужны NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const admin = createClient(url, key);

function digitsOnly(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15 ? digits : null;
}

function normalizeLid(value) {
  return String(value ?? '').split('@')[0].split(':')[0];
}

async function loadMappings() {
  const map = new Map();
  let dirs;
  try {
    dirs = await fs.readdir(AUTH_ROOT, { withFileTypes: true });
  } catch {
    console.error(`Папка не найдена: ${AUTH_ROOT}. Запусти скрипт там, где лежит baileys-auth.`);
    process.exit(1);
  }

  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const dirPath = path.join(AUTH_ROOT, dir.name);
    let files = [];
    try {
      files = await fs.readdir(dirPath);
    } catch {
      continue;
    }

    for (const file of files) {
      const m = file.match(/^lid-mapping-(\d+)_reverse\.json$/);
      if (!m) continue;

      try {
        const payload = JSON.parse(await fs.readFile(path.join(dirPath, file), 'utf8'));
        const phone = digitsOnly(payload);
        if (phone) map.set(m[1], phone);
      } catch {
        // битый файл пропускаем
      }
    }
  }

  return map;
}

const mappings = await loadMappings();
console.log(`Найдено сопоставлений LID -> номер: ${mappings.size}`);
console.log(APPLY ? 'Режим: ЗАПИСЬ' : 'Режим: dry-run (ничего не пишется)');

let scanned = 0;
let alreadyHave = 0;
let resolved = 0;
let unresolved = 0;
let failed = 0;

for (let from = 0; ; from += PAGE) {
  const { data, error } = await admin
    .from('leads')
    .select('id, external_id, attributes')
    .like('external_id', '%@lid')
    .order('id')
    .range(from, from + PAGE - 1);

  if (error) {
    console.error('Ошибка чтения leads:', error.message);
    process.exit(1);
  }

  if (!data || data.length === 0) break;

  for (const lead of data) {
    scanned++;
    const attrs = lead.attributes ?? {};
    if (digitsOnly(attrs.whatsapp_phone)) {
      alreadyHave++;
      continue;
    }

    const lid = normalizeLid(lead.external_id);
    const phone = mappings.get(lid);
    if (!phone) {
      unresolved++;
      continue;
    }

    resolved++;
    if (APPLY) {
      const { error: upErr } = await admin
        .from('leads')
        .update({ attributes: { ...attrs, whatsapp_phone: phone } })
        .eq('id', lead.id);

      if (upErr) {
        failed++;
        console.error(`Не удалось обновить ${lead.id}: ${upErr.message}`);
      }
    }
  }

  if (data.length < PAGE) break;
}

console.log(JSON.stringify({
  scanned,
  alreadyHave,
  resolved,
  unresolved,
  failed,
  mode: APPLY ? 'write' : 'dry-run',
}, null, 2));
