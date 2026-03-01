/**
 * Generate app icons for YourBooks Lite
 * Run: node scripts/generate-icons.js
 */
const sharp = require('sharp');
const path = require('path');

const BG_COLOR = '#1a1a2e';

async function generateIcon(size, outputPath, isAdaptive = false) {
  const padding = isAdaptive ? Math.round(size * 0.2) : Math.round(size * 0.08);
  const innerSize = size - padding * 2;

  // Yellow notebook (📒 emoji style) with spiral rings + "YB LITE"
  const bookW = Math.round(innerSize * 0.72);
  const bookH = Math.round(innerSize * 0.82);
  const bookX = Math.round((size - bookW) / 2) + Math.round(size * 0.03); // shift right a bit for rings
  const bookY = Math.round((size - bookH) / 2);
  const r = Math.round(size * 0.04); // corner radius

  // Spiral rings on left
  const ringCount = 5;
  const ringR = Math.round(size * 0.025);
  const ringStroke = Math.round(size * 0.006);
  const ringX = bookX - Math.round(ringR * 0.3);
  const ringStartY = bookY + Math.round(bookH * 0.1);
  const ringSpacing = Math.round((bookH * 0.8) / (ringCount - 1));

  // Page lines
  const lineStartX = bookX + Math.round(bookW * 0.15);
  const lineEndX = bookX + bookW - Math.round(bookW * 0.08);

  // Text sizes
  const ybSize = Math.round(innerSize * 0.26);
  const liteSize = Math.round(innerSize * 0.12);
  const textCX = bookX + Math.round(bookW * 0.53);

  const rings = Array.from({ length: ringCount }, (_, i) => {
    const cy = ringStartY + i * ringSpacing;
    return `<circle cx="${ringX}" cy="${cy}" r="${ringR}" fill="none" stroke="#888" stroke-width="${ringStroke}"/>
      <circle cx="${ringX}" cy="${cy}" r="${Math.round(ringR * 0.35)}" fill="${BG_COLOR}"/>`;
  }).join('\n      ');

  const lines = [0.52, 0.62, 0.72].map(pct => {
    const ly = bookY + Math.round(bookH * pct);
    return `<line x1="${lineStartX}" y1="${ly}" x2="${lineEndX}" y2="${ly}" stroke="#C8A000" stroke-width="${Math.round(size * 0.003)}" opacity="0.4"/>`;
  }).join('\n        ');

  const svg = `
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="coverGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#FFE54C"/>
          <stop offset="50%" style="stop-color:#FFD600"/>
          <stop offset="100%" style="stop-color:#FFC800"/>
        </linearGradient>
        <linearGradient id="pageGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:#FFF8E1"/>
          <stop offset="100%" style="stop-color:#FFECB3"/>
        </linearGradient>
        <filter id="shadow">
          <feDropShadow dx="0" dy="${Math.round(size * 0.008)}" stdDeviation="${Math.round(size * 0.015)}" flood-color="#000" flood-opacity="0.35"/>
        </filter>
      </defs>

      <!-- Background -->
      <rect width="${size}" height="${size}" fill="${BG_COLOR}" rx="${isAdaptive ? 0 : Math.round(size * 0.18)}"/>

      <!-- Book with shadow -->
      <g filter="url(#shadow)">
        <!-- Cover (yellow) -->
        <rect x="${bookX}" y="${bookY}" width="${bookW}" height="${bookH}" rx="${r}" fill="url(#coverGrad)" stroke="#E6C200" stroke-width="${Math.round(size * 0.004)}"/>

        <!-- Inner page area (cream) -->
        <rect x="${bookX + Math.round(bookW * 0.08)}" y="${bookY + Math.round(bookH * 0.04)}" 
              width="${bookW - Math.round(bookW * 0.14)}" height="${bookH - Math.round(bookH * 0.08)}" 
              rx="${Math.round(r * 0.6)}" fill="url(#pageGrad)"/>

        <!-- Faint page lines -->
        ${lines}
      </g>

      <!-- Spiral rings -->
      ${rings}

      <!-- YB text (upper third of page) -->
      <text x="${textCX}" y="${bookY + Math.round(bookH * 0.30)}" 
            font-family="Arial, Helvetica, sans-serif" font-size="${ybSize}" font-weight="900" 
            fill="#1a1a2e" text-anchor="middle" dominant-baseline="middle"
            letter-spacing="${Math.round(ybSize * 0.08)}">YB</text>

      <!-- LITE text (clearly below YB with good gap) -->
      <text x="${textCX}" y="${bookY + Math.round(bookH * 0.48)}" 
            font-family="Arial, Helvetica, sans-serif" font-size="${liteSize}" font-weight="700" 
            fill="#e94560" text-anchor="middle" dominant-baseline="middle"
            letter-spacing="${Math.round(liteSize * 0.15)}">LITE</text>
    </svg>
  `;

  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile(outputPath);

  console.log(`Generated: ${path.basename(outputPath)} (${size}x${size})`);
}

async function main() {
  const imagesDir = path.join(__dirname, '..', 'assets', 'images');
  
  // Main icon (1024x1024)
  await generateIcon(1024, path.join(imagesDir, 'icon.png'));
  
  // Adaptive icon foreground (1024x1024 with padding)
  await generateIcon(1024, path.join(imagesDir, 'adaptive-icon.png'), true);
  
  // Splash icon (200x200)
  await generateIcon(200, path.join(imagesDir, 'splash-icon.png'));
  
  // Favicon (48x48)
  await generateIcon(48, path.join(imagesDir, 'favicon.png'));
  
  console.log('\nAll icons generated! Rebuild the app to see changes.');
}

main().catch(console.error);
