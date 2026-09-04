const { Jimp } = require('jimp');

async function run() {
  const imagePath = 'assets/vessel_right.png';
  const colorHex = '#4A86E8'; // Blue
  
  const image = await Jimp.read(imagePath);
  
  // Convert hex to RGB
  const hex = colorHex.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  
  console.log('RGB:', r, g, b);

  image.scan(0, 0, image.bitmap.width, image.bitmap.height, function (x, y, idx) {
    const a = this.bitmap.data[idx + 3];
    if (a > 50) { 
      this.bitmap.data[idx + 0] = r;
      this.bitmap.data[idx + 1] = g;
      this.bitmap.data[idx + 2] = b;
    }
  });

  await image.write('assets/vessel_test_color.png');
  console.log('Saved assets/vessel_test_color.png');
}

run().catch(console.error);
