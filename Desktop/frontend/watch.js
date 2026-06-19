const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('Starting custom file watcher...');

// Run initial build
try {
  execSync('node build.js', { stdio: 'inherit' });
} catch (e) {
  console.error('Initial build failed:', e);
}

const filesToWatch = [
  'index.html',
  'app.js',
  'styles.css',
  'favicon.svg',
  'login.css'
];

filesToWatch.forEach(file => {
  const filePath = path.join(__dirname, file);
  if (fs.existsSync(filePath)) {
    fs.watch(filePath, (eventType) => {
      if (eventType === 'change') {
        console.log(`${file} changed, rebuilding...`);
        try {
          fs.copyFileSync(filePath, path.join(__dirname, 'dist', file));
          console.log(`Copied updated ${file} to dist/`);
        } catch (e) {
          console.error(`Error copying ${file}:`, e);
        }
      }
    });
  }
});

// Keep process alive
setInterval(() => {}, 1000);
