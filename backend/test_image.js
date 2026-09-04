const ExcelJS = require('exceljs');
const fs = require('fs');

async function run() {
  const w = new ExcelJS.Workbook();
  const s = w.addWorksheet('test');
  
  // Make some cells
  for(let i=1; i<=10; i++) {
    s.getColumn(i).width = 10;
    s.getRow(i).height = 20;
  }

  // create a dummy 1x1 png image base64
  const base64Image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  const imageId = w.addImage({
    base64: base64Image,
    extension: 'png',
  });

  // Try fractional offsets
  s.addImage(imageId, {
    tl: { col: 1.5, row: 1.5 },
    br: { col: 4.2, row: 5.8 }
  });

  await w.xlsx.writeFile('scratch_fractional_image.xlsx');
  console.log('Saved scratch_fractional_image.xlsx');
}

run().catch(console.error);
