const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

async function testSvgStretch() {
   const svgPath = path.join(process.cwd(), 'assets', 'vessel-silhouette.svg');
   let baseSvg = fs.readFileSync(svgPath, 'utf8');
   
   // Replace currentColor
   let coloredSvg = baseSvg.replace(/currentColor/g, '#4A86E8');
   
   // Inject width, height and preserveAspectRatio
   const widthPx = Math.max(1, Math.round(1144));
   const heightPx = Math.max(1, Math.round(4800));
   
   coloredSvg = coloredSvg.replace('<svg ', `<svg width="${widthPx}" height="${heightPx}" preserveAspectRatio="none" `);
   
   let sharpInstance = sharp(Buffer.from(coloredSvg));
   
   const finalBuffer = await sharpInstance.png().toBuffer();
   fs.writeFileSync('assets/test_svg_stretch.png', finalBuffer);
   console.log('Saved SVG stretched PNG');
}

testSvgStretch().catch(console.error);
