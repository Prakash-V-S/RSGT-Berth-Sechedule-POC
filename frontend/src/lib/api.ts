import { PositionedVesselSchedule } from '@/types/berth-schedule';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

/**
 * Fetches the berth schedule from the backend REST API.
 * No caching/error-handling strategy has been implemented yet —
 * this is a minimal client to unblock the visualization component.
 */
export async function fetchBerthSchedule(): Promise<PositionedVesselSchedule[]> {
  const response = await fetch(`${API_BASE_URL}/berth-schedule`);

  if (!response.ok) {
    throw new Error(`Failed to fetch berth schedule: ${response.status}`);
  }

  return response.json();
}
