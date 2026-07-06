const fs = require('fs');
const text = fs.readFileSync('temp-ali-prompt.txt', 'utf8');
const wrap = (s, width) => {
  const words = s.split(' ');
  let line = '';
  const res = [];
  for (const word of words) {
    if ((line + ' ' + word).trim().length > width) {
      res.push(line.trim());
      line = word;
    } else {
      line = (line + ' ' + word).trim();
    }
  }
  if (line) res.push(line);
  return res.join('\n');
};
const lines = text.split('\n');
const wrappedLines = [];
for (let i = 0; i < lines.length; i++) {
  const wrapped = wrap(lines[i], 80).split('\n');
  wrapped.forEach((wl, j) => {
    const num = `${i + 1}.${j + 1}`;
    wrappedLines.push(`${num} ${wl}`);
  });
}
fs.writeFileSync('temp-ali-prompt-lines-wrapped.txt', wrappedLines.join('\n'), 'utf8');
console.log('created wrapped numbered prompt');
