const ts = require('typescript');
const fs = require('fs');
const txt = fs.readFileSync('c:/Users/ЗС/Desktop/SatuSystem/lib/ai/orchestrator.ts','utf8');
const scanner = ts.createScanner(ts.ScriptTarget.ESNext, false, ts.LanguageVariant.Standard, txt);
let token = scanner.scan();
let depth = 0;let lineCol = (pos)=>{const upto=txt.slice(0,pos); const lines=upto.split('\n'); return lines.length+':'+(lines[lines.length-1].length+1)};
while(token!==ts.SyntaxKind.EndOfFileToken){ if(token===ts.SyntaxKind.OpenBraceToken){ depth++; console.log('open at',lineCol(scanner.getTokenPos())); } if(token===ts.SyntaxKind.CloseBraceToken){ depth--; console.log('close at',lineCol(scanner.getTokenPos())); } token = scanner.scan(); }
console.log('final depth',depth);
