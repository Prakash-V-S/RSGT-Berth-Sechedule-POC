const sharp = require('sharp');

async function vesselCard(facesLeft, color, out) {
  const w = 360, h = 420;
  const padX = 18, padTop = 12;
  const shipW = w - padX * 2, shipH = 110;
  const bg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="${w}" height="${h}" rx="14" fill="${color}"/></svg>`;
  let ship = sharp('assets/vessel-full.png').resize(shipW, shipH, {
    fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  });
  if (facesLeft) ship = ship.flop();
  const shipBuf = await ship.png().toBuffer();
  const arrowW = 160, arrowH = 22, arrowLeft = Math.round((w - arrowW) / 2);
  const arrowTop = padTop + shipH + 6;
  const arrow = facesLeft
    ? `<svg width="${arrowW}" height="${arrowH}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 24"><polygon points="0,12 28,0 28,7 100,7 100,17 28,17 28,24" fill="#1A3A6B"/></svg>`
    : `<svg width="${arrowW}" height="${arrowH}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 24"><polygon points="100,12 72,0 72,7 0,7 0,17 72,17 72,24" fill="#1A3A6B"/></svg>`;
  const text = `<svg width="${w}" height="240" xmlns="http://www.w3.org/2000/svg">
    <text x="50%" y="18%" text-anchor="middle" font-family="Arial" font-size="20" font-weight="700">MSC SIMONA ADHOC</text>
    <text x="50%" y="34%" text-anchor="middle" font-family="Arial" font-size="16" font-weight="700">LOA 366M/51M</text>
    <text x="50%" y="50%" text-anchor="middle" font-family="Arial" font-size="15" font-weight="700">ETA 03/1400 ETB 03/1600 ETD 05/1900</text>
    <text x="50%" y="66%" text-anchor="middle" font-family="Arial" font-size="15" font-weight="700">MOVES 5034 MSC AKI/JIB</text>
    <text x="50%" y="82%" text-anchor="middle" font-family="Arial" font-size="15" font-weight="700">DIS 2136/ LOAD 2898</text>
  </svg>`;
  await sharp(Buffer.from(bg))
    .composite([
      { input: shipBuf, top: padTop, left: padX },
      { input: Buffer.from(arrow), top: arrowTop, left: arrowLeft },
      { input: Buffer.from(text), top: arrowTop + arrowH + 8, left: 0 },
    ])
    .png()
    .toFile(out);
  console.log('wrote', out);
}

async function sticky(startM, endM, label, color, out) {
  const w = 78, h = 300;
  const fill = (() => {
    const r = parseInt(color.slice(1, 3), 16), g = parseInt(color.slice(3, 5), 16), b = parseInt(color.slice(5, 7), 16);
    const mix = (c) => Math.round(c + (255 - c) * 0.28);
    return `#${[mix(r), mix(g), mix(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  })();
  const darken = (c) => Math.max(0, Math.round(c * 0.72));
  const r = parseInt(color.slice(1, 3), 16), g = parseInt(color.slice(3, 5), 16), b = parseInt(color.slice(5, 7), 16);
  const border = `#${[darken(r), darken(g), darken(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="12" fill="${fill}" stroke="${border}" stroke-width="2"/>
    <circle cx="18" cy="36" r="7" fill="${border}" stroke="#111" stroke-width="1.5"/>
    <text x="48" y="28" text-anchor="middle" font-family="Arial" font-size="10" font-weight="700">START</text>
    <text x="48" y="48" text-anchor="middle" font-family="Arial" font-size="13" font-weight="700">${startM}M</text>
    <line x1="18" y1="48" x2="18" y2="250" stroke="${border}" stroke-width="3" stroke-linecap="round"/>
    <text x="48" y="160" fill="#111" font-family="Arial" font-size="16" font-weight="700" text-anchor="middle"
      transform="rotate(-90 48 160)">${label}</text>
    <circle cx="18" cy="266" r="7" fill="#111" stroke="${border}" stroke-width="2"/>
    <text x="48" y="258" text-anchor="middle" font-family="Arial" font-size="10" font-weight="700">END</text>
    <text x="48" y="278" text-anchor="middle" font-family="Arial" font-size="13" font-weight="700">${endM}M</text>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(out);
  console.log('wrote', out);
}

(async () => {
  await vesselCard(false, '#E6B8AF', 'assets/preview-vessel-right.png');
  await vesselCard(true, '#D5A6BD', 'assets/preview-vessel-left.png');
  await sticky(31, 291, 'ADHOC', '#4A86E8', 'assets/preview-sticky-startend.png');
})();
