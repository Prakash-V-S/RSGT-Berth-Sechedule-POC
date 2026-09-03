/**
 * Central configuration loader for the application.
 * All environment variables are resolved here so the rest of the
 * codebase depends on typed config values, not process.env directly.
 */
export default () => ({
  port: parseInt(process.env.PORT ?? '3001', 10),
  csv: {
    filePath: process.env.CSV_FILE_PATH ?? './data/sample-berth-schedule.csv',
  },
  cors: {
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
  },
});
