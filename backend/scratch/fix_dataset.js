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
                const months = { 'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'May': 5, 'Jun': 6, 'Jul': 7, 'Aug': 8, 'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12 };
                month = months[split[1]];
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
        if (!year || !month || !day) return new Date(dateStr);
        return new Date(Date.UTC(year, month - 1, day, hr, min, 0));
    } catch (e) {
        return new Date(dateStr);
    }
};

async function fixDataset() {
    const inputPath = path.join(process.cwd(), 'data', 'vessels.csv');
    const outputPath = path.join(process.cwd(), 'data', 'vessels_fixed.csv');
    
    const records = [];
    await new Promise((resolve) => {
        fs.createReadStream(inputPath)
            .pipe(csv({ skipLines: 1 }))
            .on('data', (row) => records.push(row))
            .on('end', resolve);
    });

    const berthAvailability = {};

    for (const rec of records) {
        // Parse original times
        let eta = parseDate(rec['ATA'] || rec['ETA']);
        let etd = parseDate(rec['ETD']);
        
        if (!eta || !etd) continue;

        // 1. Max 4 days duration
        let durationMs = etd.getTime() - eta.getTime();
        const maxDurationMs = 4 * 24 * 60 * 60 * 1000; // 4 days
        
        if (durationMs > maxDurationMs) {
            durationMs = maxDurationMs;
            etd = new Date(eta.getTime() + durationMs);
        }

        // 2. Fix overlaps per berth
        const berth = rec['vessel berth'];
        if (!berthAvailability[berth]) {
            berthAvailability[berth] = new Date(0);
        }

        let availTime = berthAvailability[berth];
        if (eta.getTime() < availTime.getTime()) {
            // Shift ETA to when the berth is available (+ 1 hour buffer)
            eta = new Date(availTime.getTime() + 60 * 60 * 1000);
            etd = new Date(eta.getTime() + durationMs);
        }

        // Update berth availability
        berthAvailability[berth] = etd;

        // Format dates back for CSV (DD-MM-YYYY HHmm)
        const formatForCsv = (d) => {
            const dd = d.getUTCDate().toString().padStart(2, '0');
            const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
            const yyyy = d.getUTCFullYear();
            const hh = d.getUTCHours().toString().padStart(2, '0');
            const mins = d.getUTCMinutes().toString().padStart(2, '0');
            return `${dd}-${mm}-${yyyy} ${hh}${mins}`;
        };

        if (rec['ATA']) rec['ATA'] = formatForCsv(eta);
        else rec['ETA'] = formatForCsv(eta);
        
        rec['ETD'] = formatForCsv(etd);
    }

    if (records.length === 0) return;
    
    // Manually write CSV
    const headers = Object.keys(records[0]);
    let csvContent = 'Displaying 10 item(s) at 2026-09-02,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,\n';
    csvContent += headers.map(h => h.includes(',') ? `"${h}"` : h).join(',') + '\n';
    
    for (const rec of records) {
        const row = headers.map(h => {
            let val = rec[h] || '';
            // Escape quotes if needed, or just wrap in quotes if contains comma
            if (val.includes(',')) return `"${val}"`;
            return val;
        });
        csvContent += row.join(',') + '\n';
    }

    fs.writeFileSync(outputPath, csvContent, 'utf8');
    console.log('Fixed dataset saved to', outputPath);
    
    // Update .env to use the fixed dataset
    let envStr = fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8');
    envStr = envStr.replace(/INPUT_CSV_PATH=.*/, 'INPUT_CSV_PATH="./data/vessels_fixed.csv"');
    if (!envStr.includes('INPUT_CSV_PATH')) {
        envStr += '\nINPUT_CSV_PATH="./data/vessels_fixed.csv"';
    }
    fs.writeFileSync(path.join(process.cwd(), '.env'), envStr);
    console.log('Updated .env to use vessels_fixed.csv');
}

fixDataset().catch(console.error);
