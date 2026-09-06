const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const softenColor = (hex, amount = 0.35) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const mix = (c) => Math.round(c + (255 - c) * amount);
  return `#${[mix(r), mix(g), mix(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};

const getLuminance = (hex) => {
  let r = parseInt(hex.substring(1, 3), 16) / 255;
  let g = parseInt(hex.substring(3, 5), 16) / 255;
  let b = parseInt(hex.substring(5, 7), 16) / 255;
  r = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
  g = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
  b = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

async function sticky(label, colorHex, facesLeft, w, h, out) {
  const fill = softenColor(colorHex, 0.28);
  const r = parseInt(colorHex.slice(1, 3), 16);
  const g = parseInt(colorHex.slice(3, 5), 16);
  const b = parseInt(colorHex.slice(5, 7), 16);
  const darken = (c) => Math.max(0, Math.round(c * 0.72));
  const borderHex = `#${[darken(r), darken(g), darken(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  const textColor = getLuminance(fill) > 0.4 ? '#1A1A1A' : '#FFFFFF';
  const radius = Math.max(6, Math.round(w * 0.18));
  const pad = Math.max(3, Math.round(w * 0.08));
  const shipH = Math.max(12, Math.min(Math.round(h * 0.22), Math.round(w * 1.1)) - pad);
  const shipW = Math.max(16, w - pad * 2);

  const bg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${fill}"/>
      <stop offset="100%" stop-color="${softenColor(colorHex, 0.12)}"/>
    </linearGradient></defs>
    <rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="${radius}" fill="url(#g)" stroke="${borderHex}" stroke-width="2"/>
  </svg>`;

  let ship = sharp('assets/vessel-photo.png').resize(shipW, shipH, { fit: 'cover' });
  if (facesLeft) ship = ship.flop();
  const shipBuf = await ship.png().toBuffer();

  const chevronTop = pad + shipH + 2;
  const chevronH = Math.max(8, Math.round(w * 0.22));
  const chevronW = shipW;
  const chevron = facesLeft
    ? `<svg width="${chevronW}" height="${chevronH}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 12"><polygon points="0,6 12,0 12,4 40,4 40,8 12,8 12,12" fill="${borderHex}"/></svg>`
    : `<svg width="${chevronW}" height="${chevronH}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 12"><polygon points="40,6 28,0 28,4 0,4 0,8 28,8 28,12" fill="${borderHex}"/></svg>`;

  const labelTop = chevronTop + chevronH + 4;
  const footH = Math.round(w * 0.5);
  const labelH = h - labelTop - footH - 2;
  const fontSize = Math.max(11, Math.min(22, Math.round(w * 0.42)));
  const cx = w / 2;
  const cy = labelH / 2;
  const labelSvg = `<svg width="${w}" height="${labelH}" xmlns="http://www.w3.org/2000/svg">
    <text x="${cx}" y="${cy}" fill="${textColor}" font-family="Arial" font-size="${fontSize}" font-weight="700"
      text-anchor="middle" dominant-baseline="middle" transform="rotate(-90 ${cx} ${cy})">${label}</text>
  </svg>`;
  const foot = `<svg width="${w}" height="${footH}" xmlns="http://www.w3.org/2000/svg">
    <text x="50%" y="50%" fill="${textColor}" font-family="Arial" font-size="${Math.max(9, Math.round(w * 0.28))}"
      font-weight="700" text-anchor="middle" dominant-baseline="middle">366M</text>
  </svg>`;

  await sharp(Buffer.from(bg))
    .composite([
      { input: shipBuf, top: pad + 2, left: pad },
      { input: Buffer.from(chevron), top: chevronTop, left: pad },
      { input: Buffer.from(labelSvg), top: labelTop, left: 0 },
      { input: Buffer.from(foot), top: h - footH - 2, left: 0 },
    ])
    .png()
    .toFile(out);
  console.log('wrote', out);
}

(async () => {
  await sticky('RES2WB', '#4A86E8', false, 72, 320, 'assets/preview-sticky-r1.png');
  await sticky('REX2-WB', '#E6B8AF', true, 72, 220, 'assets/preview-sticky-r4.png');
  await sticky('COS-R', '#93C47D', false, 72, 280, 'assets/preview-sticky-b4.png');
})();
