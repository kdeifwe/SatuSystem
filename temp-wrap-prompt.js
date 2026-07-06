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
const wrapped = text.split('\n').map((l) => wrap(l, 110)).join('\n');
fs.writeFileSync('temp-ali-prompt-wrapped.txt', wrapped, 'utf8');
console.log('wrapped');
