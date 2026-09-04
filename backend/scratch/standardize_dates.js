const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

const parseDate = (dateStr) => {
    if (!dateStr) return null;
    try {
        const parts = dateStr.trim().split(' ');
        if (parts.length < 2) return new Date(dateStr);
        const datePart = parts[0];
        const timePart = parts[1];
        let day, month, year;
        if (datePart.includes('-')) {
            const split = datePart.split('-');
            if (split[1].length === 3) {
                // e.g. 26-Sep-02 (YY-MMM-DD)
                year = 2000 + parseInt(split[0]);
                const months = { 'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'May': 5, 'Jun': 6, 'Jul': 7, 'Aug': 8, 'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12,
                                 'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6, 'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12 };
                month = months[split[1].substring(0,3)];
                day = parseInt(split[2]);
            } else if (split[2] && split[2].length === 4) {
                // e.g. 30-08-2026
                day = parseInt(split[0]);
                month = parseInt(split[1]);
                year = parseInt(split[2]);
            } else if (split[0] && split[0].length === 4) {
                // e.g. 2026-09-02
                year = parseInt(split[0]);
                month = parseInt(split[1]);
                day = parseInt(split[2]);
            }
        }
        let hr = 0, min = 0;
        if (timePart.includes(':')) {
            const timeSplit = timePart.split(':');
            hr = parseInt(timeSplit[0]);
            min = parseInt(timeSplit[1]);
        } else if (timePart.length === 4) {
            hr = parseInt(timePart.slice(0, 2));
            min = parseInt(timePart.slice(2, 4));
        }
        if (!year || !month || !day) {
            const d = new Date(dateStr);
            if (!isNaN(d.getTime())) return d;
            return null;
        }
        return new Date(Date.UTC(year, month - 1, day, hr, min, 0));
    } catch (e) {
        return null;
    }
};

const formatForCsv = (d) => {
    if (!d || isNaN(d.getTime())) return '';
    const dd = d.getUTCDate().toString().padStart(2, '0');
    const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
    const yyyy = d.getUTCFullYear();
    const hh = d.getUTCHours().toString().padStart(2, '0');
    const mins = d.getUTCMinutes().toString().padStart(2, '0');
    return `${dd}-${mm}-${yyyy} ${hh}${mins}`;
};

async function standardizeDates() {
    const inputPath = path.join(process.cwd(), 'data', 'vessels.csv');
    
    const records = [];
    await new Promise((resolve) => {
        fs.createReadStream(inputPath)
            .pipe(csv({ skipLines: 1 }))
            .on('data', (row) => records.push(row))
            .on('end', resolve);
    });

    const dateCols = ['Est. Time of Berth', 'ETD', 'ETA', 'ATA', 'ATD', 'ATB'];

    for (const rec of records) {
        for (const col of dateCols) {
            if (rec[col]) {
                const parsed = parseDate(rec[col]);
                if (parsed) {
                    rec[col] = formatForCsv(parsed);
                }
            }
        }
    }

    if (records.length === 0) return;
    
    const headers = Object.keys(records[0]);
    let csvContent = 'Displaying 10 item(s) at 2026-09-02,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,\n';
    csvContent += headers.map(h => h.includes(',') ? `"${h}"` : h).join(',') + '\n';
    
    for (const rec of records) {
        const row = headers.map(h => {
            let val = rec[h] || '';
            if (val.includes(',')) return `"${val}"`;
            return val;
        });
        csvContent += row.join(',') + '\n';
    }

    fs.writeFileSync(inputPath, csvContent, 'utf8');
    console.log('Standardized dates in', inputPath);
}

standardizeDates().catch(console.error);
