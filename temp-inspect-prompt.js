const fs = require('fs');
const text = fs.readFileSync('temp-ali-prompt.txt', 'utf8');
const lines = text.split('\n');
console.log('lines', lines.length);
const markers = ['<IDENTITY_PROTECTION>', '<HANDOFF_PROTOCOL>', '<MEMORY_MODEL>', 'KNOWLEDGE_BASE_PRINCIPLES'];
for (const m of markers) {
  const idx = lines.findIndex((l) => l.includes(m));
  console.log(m, idx);
}
fs.writeFileSync('temp-ali-prompt-lines.txt', lines.map((l, i) => `${i+1}: ${l}`).join('\n'), 'utf8');
