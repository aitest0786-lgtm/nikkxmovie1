const fs = require('fs');

function checkFile(filename) {
  const code = fs.readFileSync(filename, 'utf8');
  let index = 0;
  const target = "nikkXmovie";
  while ((index = code.toLowerCase().indexOf(target.toLowerCase(), index)) !== -1) {
    const start = Math.max(0, index - 50);
    const end = Math.min(code.length, index + 150);
    console.log(`Match in ${filename} at ${index}:\n${code.substring(start, end).replace(/\n/g, ' ')}\n-----------------\n`);
    index += target.length;
  }
}

checkFile('app.js');
checkFile('server.js');
