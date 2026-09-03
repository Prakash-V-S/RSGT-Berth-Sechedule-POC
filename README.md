# RSGT Berth Schedule POC

A lightweight proof of concept for visualizing a vessel berth schedule.
The backend reads schedule data from a configured CSV file (no database,
no authentication, no upload UI) and exposes it over a REST API. The
frontend is prepared to render a 2D berth schedule from that API.

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
  └──────API────────┘
          │
   Configured CSV
   File Location
```

- **Frontend**: Next.js + TypeScript
- **Backend**: NestJS + TypeScript
- **Communication**: REST API (JSON over HTTP)
- **Data source**: a single CSV file at a location set via environment variable
- No database, no auth, no Kafka/Redis, no microservices, no CSV upload UI

## Project structure

```
rsgt-berth-schedule/
├── backend/                     # NestJS API
│   ├── data/
│   │   └── sample-berth-schedule.csv
│   ├── src/
│   │   ├── config/
│   │   │   └── configuration.ts       # env var loading
│   │   ├── csv-reader/                 # reads the raw CSV file
│   │   ├── data-parser/                # CSV rows -> typed records
│   │   ├── position-engine/            # records -> 2D positions (stub)
│   │   ├── berth-schedule/             # REST controller wiring it together
│   │   ├── app.module.ts
│   │   └── main.ts
│   ├── .env.example
│   ├── nest-cli.json
│   ├── package.json
│   └── tsconfig.json
└── frontend/                     # Next.js app
    ├── src/
    │   ├── app/
    │   │   ├── layout.tsx
    │   │   └── page.tsx
    │   ├── components/
    │   │   └── BerthScheduleView/      # placeholder for the 2D visualization
    │   ├── lib/
    │   │   └── api.ts                  # fetch client for the backend API
    │   └── types/
    │       └── berth-schedule.ts       # types mirroring the API contract
    ├── .env.local.example
    ├── next.config.js
    ├── package.json
    └── tsconfig.json
```

## Prerequisites

- Node.js 18+ and npm

## Backend setup

```bash
cd backend
cp .env.example .env
npm install
npm run start:dev
```

The API starts on `http://localhost:3001` by default (configurable via `PORT`
in `.env`). It reads the CSV file at the path set by `CSV_FILE_PATH` (defaults
to the bundled `data/sample-berth-schedule.csv`).

Test it:

```bash
curl http://localhost:3001/berth-schedule
```

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

| Variable        | Description                                   | Default                              |
|-----------------|------------------------------------------------|---------------------------------------|
| `PORT`          | Port the NestJS API listens on                 | `3001`                                |
| `CSV_FILE_PATH` | Path to the berth schedule CSV file            | `./data/sample-berth-schedule.csv`    |
| `CORS_ORIGIN`   | Allowed origin(s) for the frontend             | `http://localhost:3000`               |

### Frontend (`frontend/.env.local`)

| Variable                    | Description                | Default                 |
|------------------------------|-----------------------------|--------------------------|
| `NEXT_PUBLIC_API_BASE_URL`  | Base URL of the backend API | `http://localhost:3001` |

## Current state

- **CSV Reader**: reads the raw file from the configured path. No format
  validation yet.
- **Data Parser**: converts CSV rows into typed `VesselScheduleRecord`
  objects. No business validation yet.
- **Position Engine**: returns each record with a placeholder `{ x: 0, y: 0 }`
  position. The real 2D layout calculation is not implemented yet.
- **REST API**: a single `GET /berth-schedule` endpoint chains the three
  services above and returns the result.
- **Frontend**: a home page with a reserved layout area
  (`BerthScheduleView`) where the 2D visualization will be built. No
  rendering logic or data fetching wired in yet.

## Next steps (not part of this POC)

- Implement real position/layout logic in the Position Engine
- Fetch and render the schedule in `BerthScheduleView`
- Decide on the CSV schema/validation rules
