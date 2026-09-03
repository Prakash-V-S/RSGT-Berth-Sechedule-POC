import { ScheduleResponse } from '../types/berth-schedule';

const USE_MOCK_DATA_FOR_TESTING = true; // Set to false to disable mock vessel

export async function fetchBerthSchedule(): Promise<ScheduleResponse> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';
  const response = await fetch(`${apiUrl}/berth-schedule`);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch berth schedule: ${response.statusText}`);
  }

  const data: ScheduleResponse = await response.json();

  if (USE_MOCK_DATA_FOR_TESTING) {
    // Inject a mock valid vessel for UI testing purposes (as requested)
    const now = Date.now();
    data.vessels.push({
      vesselName: 'MOCK VESSEL (DEV TEST)',
      status: 'Working',
      loa: 150,
      foreMeter: 200,
      aftMeter: 50,
      eta: new Date(now - 3600000).toISOString(),
      ata: new Date(now).toISOString(),
      etd: new Date(now + 7200000).toISOString(),
      position: {
        startMeter: 50,
        endMeter: 200,
        loa: 150,
        occupiedLength: 150,
        loaMismatch: false,
        startTime: new Date(now).toISOString(),
        endTime: new Date(now + 7200000).toISOString()
      }
    });
  }

  return data;
}
