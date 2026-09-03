/**
 * Shape of a single parsed row from the berth schedule CSV.
 * Field list mirrors the sample CSV columns; adjust once real
 * business requirements/CSV format are finalized.
 */
export interface VesselScheduleRecord {
  vesselName: string;
  status: string;
  loa: number;
  foreMeter: number;
  aftMeter: number;
  eta: Date | null;
  ata: Date | null;
  etd: Date | null;
}
