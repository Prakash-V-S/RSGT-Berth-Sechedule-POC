const sharp = require('sharp');
const fs = require('fs');

async function test() {
  const targetW = 682;
  const targetH = 1080;
  const colorHex = '#D5A6BD';
  
  let baseSvg = fs.readFileSync('assets/vessel-silhouette.svg', 'utf8');
  let coloredSvg = baseSvg.replace(/currentColor/g, colorHex);
  coloredSvg = coloredSvg.replace(/<svg([^>]*?)(?:\s+(?:width|height|preserveAspectRatio)="[^"]*")([^>]*?)>/g, (m) => m.replace(/\s+(?:width|height|preserveAspectRatio)="[^"]*"/g, ''));
  coloredSvg = coloredSvg.replace('<svg', `<svg width="${targetW}" height="${targetH}" preserveAspectRatio="none"`);
  
  const textColor = '#000000';
  
  let elements = [];
  elements.push(`<text x="50%" y="30%" class="title">DANIEL A</text>`);
  elements.push(`<text x="50%" y="40%" class="text">LOA 155M / 24.5M</text>`);
  elements.push(`<text x="50%" y="50%" class="text">ETA 03/0001 ETB 03/0200 ETD 04/0500</text>`);
  
  // Actually in the current implementation, we hardcoded sizes to 13px, 11px, 12px.
  // We need to see what that looks like on a 1080px image!
  const textSvg = `
    <svg width="${targetW}" height="${targetH}" xmlns="http://www.w3.org/2000/svg">
      <style>
        .title { font-family: sans-serif; font-size: 13px; font-weight: bold; fill: ${textColor}; text-anchor: middle; dominant-baseline: middle; }
        .text { font-family: sans-serif; font-size: 11px; fill: ${textColor}; text-anchor: middle; dominant-baseline: middle; }
        .meter { font-family: sans-serif; font-size: 12px; font-weight: bold; fill: ${textColor}; dominant-baseline: hanging; }
      </style>
      ${elements.join('\n')}
    </svg>
  `;
  
  let sharpInstance = sharp(Buffer.from(coloredSvg));
  sharpInstance = sharpInstance.composite([{ input: Buffer.from(textSvg), top: 0, left: 0 }]);
  await sharpInstance.png().toFile('test_svg.png');
  console.log('Done');
}
test();
