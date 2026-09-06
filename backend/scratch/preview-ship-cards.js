const sharp = require('sharp');

async function card(rec, color, orientation, w, h, out) {
  const facesLeft = orientation === 'PORT_FACING';
  const padX = Math.round(w * 0.05);
  const padTop = Math.round(h * 0.03);
  const radius = Math.round(Math.min(w, h) * 0.04);
  const shipBandH = Math.round(h * 0.28);
  const shipW = w - padX * 2;
  const shipH = shipBandH - padTop;

  const bg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="${w}" height="${h}" rx="${radius}" fill="${color}"/></svg>`;

  let ship = sharp('assets/vessel-photo.png').resize(shipW, shipH, { fit: 'cover' });
  if (facesLeft) ship = ship.flop();
  const shipBuf = await ship.png().toBuffer();

  const arrowTop = padTop + shipH + 4;
  const arrowW = Math.min(Math.round(w * 0.55), 280);
  const arrowH = 24;
  const arrowLeft = Math.round((w - arrowW) / 2);
  const arrowSvg = facesLeft
    ? `<svg width="${arrowW}" height="${arrowH}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 24"><polygon points="0,12 28,0 28,7 100,7 100,17 28,17 28,24" fill="#1A3A6B"/></svg>`
    : `<svg width="${arrowW}" height="${arrowH}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 24"><polygon points="100,12 72,0 72,7 0,7 0,17 72,17 72,24" fill="#1A3A6B"/></svg>`;

  const textTop = arrowTop + arrowH + 10;
  const textH = h - textTop - padTop;
  const text = `<svg width="${w}" height="${textH}" xmlns="http://www.w3.org/2000/svg">
    <text x="50%" y="20%" text-anchor="middle" font-family="Arial" font-size="22" font-weight="bold">${rec.name}</text>
    <text x="50%" y="40%" text-anchor="middle" font-family="Arial" font-size="18" font-weight="bold">${rec.loa}</text>
    <text x="50%" y="58%" text-anchor="middle" font-family="Arial" font-size="16" font-weight="bold">${rec.times}</text>
    <text x="50%" y="76%" text-anchor="middle" font-family="Arial" font-size="16" font-weight="bold">${rec.moves}</text>
  </svg>`;

  await sharp(Buffer.from(bg))
    .composite([
      { input: shipBuf, top: padTop, left: padX },
      { input: Buffer.from(arrowSvg), top: arrowTop, left: arrowLeft },
      { input: Buffer.from(text), top: textTop, left: 0 },
    ])
    .png()
    .toFile(out);
  console.log('wrote', out);
}

(async () => {
  await card(
    {
      name: 'MV MSC RADIANT III (WMED-RS)',
      loa: 'LOA 209M',
      times: 'ETA 07/0800 ETB 07/1400 ETD 09/TBA',
      moves: 'MOVES TBA MSC BCN/KAP',
    },
    '#E6B8AF',
    'PORT_FACING',
    420,
    520,
    'assets/preview-port-left.png',
  );
  await card(
    {
      name: 'MV CMA CGM CASSIOPEIA (RES2-WB)',
      loa: 'LOA 364M/46M',
      times: 'ETA 05/0600 ETB 05/1600 ETD 07/1000',
      moves: 'MOVES 4000 CMA JIB/SOK',
    },
    '#93C47D',
    'START_FACING',
    420,
    520,
    'assets/preview-starboard-right.png',
  );
})();
