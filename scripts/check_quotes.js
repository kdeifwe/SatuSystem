const fs = require('fs');
const s = fs.readFileSync('c:/Users/ЗС/Desktop/SatuSystem/lib/ai/orchestrator.ts','utf8');
let dq=false,sq=false,bq=false;let line=0;for(const ch of s){line++;if(ch==='"' && !sq && !bq) dq=!dq; if(ch==="'" && !dq && !bq) sq=!sq; if(ch==='`' && !dq && !sq) bq=!bq;}console.log('double',dq,'single',sq,'backtick',bq);
