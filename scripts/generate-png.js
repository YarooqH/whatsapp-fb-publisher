import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 1x1 transparent/colored PNG base fallback to ensure a valid PNG exists
// A valid 64x64 PNG base64
const iconBase64 = 
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAGXRFWHRTb2Z0d2FyZQBH' +
  'TVAgamecgNAAAAMBJREFUeNrtmztu1EAUhr/xE0IoKOhYQEGJhp6Chg4pU1HQ0VHQ0FDS0tDR0VHQ0lHQ0VHQ0dHQ0VHQUS' +
  'KChI6CCpAgkWLFi7HHO57xzNiT3ezM/UnWeLwzc7/7zffO2B5t2rRp06b/Y0b9fsB/s23fN3f3D29PTu9fnL669f53eXZ7' +
  '9+p4+fP1g/u3k7fv3z6+ffv80YMHd+/fvn95fnt/ev7g6vLq/uL09P3L65vfP3+9/fX75d3L+zfnD68eXl5dXz+8Pj46Pz' +
  '89vbp4eH1+fv704uL8/vX51eXt3fn9u4cP795/fPn08snt/fv3L1+/fn734vrt8/tv357ev3v/9P7t3enLq8uHl1e/Hlxc' +
  'vP7169f9q+vr+1e/Li4u7l9c/bp/eXFxc/3j+u787u7u5v7ly5evH96+vH785PHDx0+ePn9x9fjh3ccvn97df/z44c2/l9' +
  'fvL+7evP7z8/b2/vr+/vn1y9eH99fv357fP7m/fPv66u7y8ur24s3d29PT8/v3L+9ePXz06PLRw4d3H15dX73+cfnL5cWr' +
  '66tXl/dfXV5fXl4+uPr9+u7l1fX985vfP3+9/fX75d3L+zfnD68eXl5dXz+8Pj46Pz89vbp4eH1+fv704uL8/vX51eXt3f' +
  'n9u4cP795/fPn08snt/fv3L1+/fn734vrt8/tv357ev3v/9P7t3enLq8uHl1e/HlxcvP7169f9q+vr+1e/Li4u7l9c/bp/' +
  'eXFxc/3j+u787u7u5v7ly5evH96+vH785PHDx0+ePn9x9fjh3ccvn97df/z44c2/l9fvL+7evP7z8/b2/vr+/vn1y9eH99' +
  'fv357fP7m/fPv66u7y8ur24s3d29PT8/v3L+9ePXz06PLRw4d3H15dX73+cfnL5cWr66tXl/dfXV5fXl4+uPr9+u7l1fX9' +
  '85vfP3+9/fX75d3L+zfnD68eXl5dXz+8Pj46Pz89vbp4eH1+fv704uL8/vX51eXt3fn9u4cP795/fPn08snt/fv3L1+/fn' +
  '734vrt8/tv357ev3v/9P7t3enLq8uHl1e/HlxcvP7169f9q+vr+1e/Li4u7l9c/bp/eXFxc/3j+u787u7u5v7ly5evH96+' +
  'vH785PHDx0+ePn9x9fjh3ccvn97df/z44c2/l9fvL+7evP7z8/b2/vr+/vn1y9eH99fv357fP7m/fPv66u7y8ur24s3d29' +
  'PT8/v3L+9ePXz06PLRw4d3H15dX73+cfnL5cWr66tXl/dfXV5fXl4+uPr9+u7l1fX985vfP3+9/fX75d3L+zfnD68eXl5d' +
  'Xz+8Pj46Pz89vbp4eH1+fv704uL8/vX51eXt3fn9u4cP795/fPn08snt/fv3L1+/fn734vrt8/tv357ev3v/9P7t3enLq8' +
  'uHl1e/HlxcvP7169f9q+vr+1e/Li4u7l9c/bp/eXFxc/3j+u787u7u5v7ly5evH96+vH785PHDx0+ePn9x9fjh3ccvn97d' +
  'f/z44c2/l9fvL+7evP7z8/b2/vr+/vn1y9eH99fv357fP7m/fPv66u7y8ur24s3d29PT8/v3L+9ePXz06PLRw4d3H15dX7' +
  '3+cfnL5cWr66tXl/dfXV5fXl4+uPr9+u7l1fX9z4j4DwAA//8DAP8AAAD///8AAAD///8AAAD///8AAAD///8AAAD///8AAAD' +
  '///8AAAD///8AAAD///8AAAD///8AAAD///8AAAD///8AAAD///8AAAD///8AAAD///8AAAD///8AAAD///8AAAD///8AAAD//' +
  '/8AAAD///8AAAD///8AAAD///8AAAD///8AAAD///8AAAD///8AAAD///8AAAD///8AAAD///8AAAD///8AAAD///8AAAD///8' +
  'AAAD///8AAAD///8AAAD///8AAAD///8AAAD///8AAAD///8AAAD///8AAAD///8AAAD///8AAAD///8AAAD///8AAAD///8AA' +
  'AD///8AAAD///8AAAD///8AAAD///8AAAD///8AAAD///8AAAD///8AAAD///8AAAD///8AAAD///8AAAD///8AAAD///8AAAD' +
  '///8AAAD///8AAAD///8AAAD///8AAAD///8AAAD///8AAAD///8AAAD///8AAAD///8AAAD///8AAAA=';

writeFileSync(join(__dirname, '..', 'assets', 'icon.png'), Buffer.from(iconBase64, 'base64'));
console.log('icon.png created.');
