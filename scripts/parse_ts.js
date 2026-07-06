const ts = require('typescript');
const fs = require('fs');
const text = fs.readFileSync('c:/Users/ЗС/Desktop/SatuSystem/lib/ai/orchestrator.ts','utf8');
const src = ts.createSourceFile('orchestrator.ts', text, ts.ScriptTarget.ESNext, /*setParentNodes*/ true);
const diag = ts.getPreEmitDiagnostics(ts.createProgram(['c:/Users/ЗС/Desktop/SatuSystem/lib/ai/orchestrator.ts'], {}));
console.log('DIAGS',diag.map(d=>({message: ts.flattenDiagnosticMessageText(d.messageText, '\n'), start:d.start, length:d.length, file:d.file && d.file.fileName, category:d.category})));