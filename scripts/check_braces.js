const fs = require('fs');
const s = fs.readFileSync('c:/Users/ЗС/Desktop/SatuSystem/lib/ai/orchestrator.ts','utf8');
const lines = s.split('\n');
let depth = 0;
for (let i = 0; i < lines.length; i++) {
  const ln = lines[i];
  for (const ch of ln) {
    if (ch === '{') depth++;
    if (ch === '}') depth--;
  }
  if (i % 20 === 0 || depth > 0) console.log('L', i + 1, 'depth', depth, ln.slice(0, 120));
}
console.log('END depth', depth);