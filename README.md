# RSGT Berth Schedule POC

A lightweight proof of concept for visualizing a vessel berth schedule.
The backend reads schedule data from a configured CSV file (no database,
no authentication, no upload UI) and exposes it over a REST API. The
frontend is prepared to render a 2D berth schedule from that API.

The backend can also generate a berth plan from CSV as **Excel**, **PDF**
(MAIN BERTH PLAN only), or **both**.

## Architecture

```
RSGT BERTH SCHEDULE POC
          │
  ┌───────┴────────┐
  │                 │
Frontend         Backend
Next.js          NestJS
  │                 │
  │           CSV Reader
  │                 │
  │           Data Parser
  │                 │
  │          Position Engine
  │                 │
  │         Excel Generator
  │                 │
  │      PDF export (optional)
  │                 │
  └──────API────────┘
          │
   Configured CSV
   File Location
```

- **Frontend**: Next.js + TypeScript
- **Backend**: NestJS + TypeScript
- **Communication**: REST API (JSON over HTTP)
- **Data source**: a single CSV file at a location set via environment variable
- **Berth plan export**: Excel workbook (MAIN BERTH PLAN + BERTH DETAILS); PDF exports **MAIN BERTH PLAN** only via Microsoft Excel
- No database, no auth, no Kafka/Redis, no microservices, no CSV upload UI

## Project structure

```
rsgt-berth-schedule/
├── backend/                     # NestJS API
│   ├── data/
│   │   └── vessels.csv
│   ├── output/                  # generated berth-plan-*.xlsx / *.pdf
│   ├── template/
│   │   └── empty-template.xlsx
│   ├── src/
│   │   ├── config/
│   │   ├── csv-reader/
│   │   ├── data-parser/
│   │   ├── position-engine/
│   │   ├── excel-generator/
│   │   ├── export/
│   │   │   └── excel-to-pdf.ts  # Excel → PDF (Windows COM)
│   │   ├── generate-berth-plan.ts
│   │   ├── berth-schedule/
│   │   ├── app.module.ts
│   │   └── main.ts
│   ├── .env.example
│   ├── package.json
│   └── tsconfig.json
└── frontend/                     # Next.js app
    ├── src/
    │   ├── app/
    │   ├── components/
    │   ├── lib/
    │   └── types/
    ├── package.json
    └── tsconfig.json
```

## Prerequisites

- Node.js 18+ and npm
- **Microsoft Excel** (required for any command that produces PDF)

## Backend setup

```bash
cd backend
cp .env.example .env
npm install
npm run start:dev
```

The API starts on `http://localhost:3001` by default (configurable via `PORT`
in `.env`). It reads the CSV file at the path set by `CSV_FILE_PATH` (defaults
to the bundled sample CSV).

Test it:

```bash
curl http://localhost:3001/berth-schedule
```

## Berth plan generation

From the `backend/` folder, generate a berth plan from the configured input CSV.

### Both Excel and PDF (default)

```bash
cd backend
npm run generate:berth-plan
```

Writes:

- `output/berth-plan-<timestamp>.xlsx` (full workbook: MAIN BERTH PLAN + BERTH DETAILS)
- `output/berth-plan-<timestamp>.pdf` (**MAIN BERTH PLAN** sheet only)

### PDF only

```bash
cd backend
npm run generate:berth-plan:pdf
```

Writes:

- `output/berth-plan-<timestamp>.pdf` (**MAIN BERTH PLAN** only)

### Excel only

```bash
cd backend
npm run generate:berth-plan:xlsx
```

Writes:

- `output/berth-plan-<timestamp>.xlsx`

### Notes

- Input CSV path: `INPUT_CSV_PATH` (default `./data/vessels.csv`)
- Excel output path: `OUTPUT_EXCEL_PATH` (default timestamped under `./output/`)
- PDF output path: `OUTPUT_PDF_PATH` (optional; defaults to the Excel path with a `.pdf` extension)
- PDF export requires Microsoft Excel installed on Windows
- PDF contains only the **MAIN BERTH PLAN** sheet (not BERTH DETAILS or other sheets)
- The Excel workbook still includes **MAIN BERTH PLAN** plus **BERTH DETAILS** (valid / conflict / invalid vessels)

## Frontend setup

Open a second terminal:

```bash
cd frontend
cp .env.local.example .env.local
npm install
npm run dev
```

The app starts on `http://localhost:3000` and shows a placeholder page where
the 2D berth schedule visualization will be built next.

## Environment variables

### Backend (`backend/.env`)

| Variable            | Description                                      | Default                              |
|---------------------|--------------------------------------------------|--------------------------------------|
| `PORT`              | Port the NestJS API listens on                   | `3001`                               |
| `CSV_FILE_PATH`     | Path to the berth schedule CSV for the API       | `./data/sample-berth-schedule.csv`   |
| `INPUT_CSV_PATH`    | Path to CSV for berth plan generation CLI        | `./data/vessels.csv`                 |
| `OUTPUT_EXCEL_PATH` | Excel output path for generation CLI             | `./output/berth-plan.xlsx` (timestamped) |
| `OUTPUT_PDF_PATH`   | Optional PDF output path for generation CLI      | same as Excel with `.pdf`            |
| `CORS_ORIGIN`       | Allowed origin(s) for the frontend               | `http://localhost:3000`              |

### Frontend (`frontend/.env.local`)

| Variable                    | Description                | Default                 |
|------------------------------|-----------------------------|--------------------------|
| `NEXT_PUBLIC_API_BASE_URL`  | Base URL of the backend API | `http://localhost:3001` |

## Current state

- **CSV Reader / Data Parser / Position Engine**: used by both the REST API and berth plan generation
- **Excel Generator**: builds MAIN BERTH PLAN visuals and BERTH DETAILS status sheet
- **PDF export**: converts **MAIN BERTH PLAN** only to PDF (Excel COM on Windows)
- **REST API**: `GET /berth-schedule` returns positioned schedule JSON
- **Frontend**: placeholder page for the 2D visualization

## Next steps (not part of this POC)

- Fetch and render the schedule in `BerthScheduleView`
- Optional non-Windows PDF conversion (e.g. LibreOffice) if Excel COM is unavailable
