import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const targetDir = path.join(rootDir, 'src-tauri', 'bin');
const targetNode = path.join(targetDir, 'node.exe');

if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

if (!fs.existsSync(targetNode)) {
  console.log(`📦 Bundling Node.js runtime from ${process.execPath} -> ${targetNode}...`);
  fs.copyFileSync(process.execPath, targetNode);
  console.log('✓ Node runtime bundled successfully for standalone distribution.');
} else {
  console.log('✓ Standalone Node.js runtime already present in src-tauri/bin.');
}

console.log('📦 Bundling standalone service with esbuild...');
execSync('npm run build:service', { cwd: rootDir, stdio: 'inherit' });
console.log('✓ Service bundle generated at dist/service.js.');
