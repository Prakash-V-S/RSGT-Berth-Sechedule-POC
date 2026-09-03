const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const workbook = XLSX.readFile(path.join(__dirname, 'data', 'VesselVisitDetails_20260902_0911_with_meters (1).xlsx'));
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];
const csv = XLSX.utils.sheet_to_csv(sheet);

fs.writeFileSync(path.join(__dirname, 'data', 'vessels.csv'), csv);
console.log('Converted to data/vessels.csv');
