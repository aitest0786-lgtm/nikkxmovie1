const fs = require('fs');

const code = fs.readFileSync('app.js', 'utf8');
let index = 0;
const target = "nativeVideoPlayer.addEventListener";
while ((index = code.indexOf(target, index)) !== -1) {
  const start = Math.max(0, index - 100);
  const end = Math.min(code.length, index + 200);
  console.log(`Match at ${index}:\n${code.substring(start, end)}\n-----------------\n`);
  index += target.length;
}
