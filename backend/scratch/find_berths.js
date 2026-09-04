const ExcelJS = require('exceljs');
const path = require('path');

async function inspectBerths() {
  const workbook = new ExcelJS.Workbook();
  const filePath = path.join(process.cwd(), '../empty-template.xlsx');
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.getWorksheet('MAIN BERTH PLAN');

  console.log('--- Merged Cells ---');
  for (const merge of sheet._merges) {
      const topRow = merge.model.top;
      const val = sheet.getCell(topRow, merge.model.left).value;
      if (val && typeof val === 'string' && val.includes('R')) {
          console.log(`Merge: ${merge.model.left} to ${merge.model.right} at row ${topRow} (Cols: ${merge.model.left} to ${merge.model.right}) -> Value: ${val}`);
      }
  }
}

inspectBerths().catch(console.error);
