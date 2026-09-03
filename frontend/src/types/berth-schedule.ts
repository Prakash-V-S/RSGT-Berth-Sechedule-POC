export interface CalculatedPosition {
  startMeter: number;
  endMeter: number;
  loa: number;
  occupiedLength: number;
  loaMismatch: boolean;
  startTime: string; // ISO date string
  endTime: string;   // ISO date string
}

export interface PositionedVesselSchedule {
  vesselName: string;
  status: string;
  loa: number;
  foreMeter: number;
  aftMeter: number;
  eta: string | null;
  ata: string | null;
  etd: string | null;
  position: CalculatedPosition;
}

export interface ScheduleError {
  vesselName: string;
  message: string;
}

export interface ScheduleResponse {
  berth: {
    length: number;
  };
  vessels: PositionedVesselSchedule[];
  errors: ScheduleError[];
}
