const sharp = require('sharp');
const fs = require('fs');

async function testSharp() {
   const colorHex = '#4A86E8'; // Blue
   const imagePath = 'D:/RSGT Berth Sechedule POC/rsgt-berth-schedule/backend/assets/vessel-silhouette.png';
   
   const metadata = await sharp(imagePath).metadata();
   console.log('Original size:', metadata.width, metadata.height);

   // Colorize
   const coloredBuffer = await sharp(imagePath)
       .composite([{
           input: {
               create: {
                   width: metadata.width,
                   height: metadata.height,
                   channels: 4,
                   background: colorHex
               }
           },
           blend: 'in'
       }])
       .png()
       .toBuffer();

   // Resize with padding (contain)
   // Suppose bounding box is 500x300
   const finalBuffer = await sharp(coloredBuffer)
       .resize({
           width: 500,
           height: 300,
           fit: 'contain',
           background: { r: 0, g: 0, b: 0, alpha: 0 }
       })
       //.flop() // mirror test
       .png()
       .toBuffer();

   fs.writeFileSync('D:/RSGT Berth Sechedule POC/rsgt-berth-schedule/backend/assets/test_output.png', finalBuffer);
   console.log('Saved test_output.png');
}

testSharp().catch(console.error);
