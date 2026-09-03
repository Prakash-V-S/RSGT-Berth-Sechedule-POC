import React from 'react';
import { PositionedVesselSchedule } from '../../types/berth-schedule';
import styles from './BerthSchedule.module.css';

interface VesselBlockProps {
  vessel: PositionedVesselSchedule;
  minTime: number; // in milliseconds
  pixelsPerMeter: number;
  pixelsPerHour: number;
  onClick: (vessel: PositionedVesselSchedule) => void;
}

export function VesselBlock({ vessel, minTime, pixelsPerMeter, pixelsPerHour, onClick }: VesselBlockProps) {
  const startMs = new Date(vessel.position.startTime).getTime();
  const endMs = new Date(vessel.position.endTime).getTime();
  
  // Calculate vertical position and height based on time
  const hoursFromTop = (startMs - minTime) / (1000 * 60 * 60);
  const durationHours = (endMs - startMs) / (1000 * 60 * 60);
  
  const top = hoursFromTop * pixelsPerHour;
  const height = durationHours * pixelsPerHour;
  
  // Calculate horizontal position and width based on meters
  const left = vessel.position.startMeter * pixelsPerMeter;
  const width = vessel.position.occupiedLength * pixelsPerMeter;

  // Determine status class
  const statusClass = vessel.status.toLowerCase() === 'inbound' ? styles.inbound : styles.working;

  return (
    <div 
      className={`${styles.vesselBlock} ${statusClass}`}
      style={{
        top: `${top}px`,
        left: `${left}px`,
        width: `${width}px`,
        height: `${Math.max(height, 20)}px`, // minimum height for visibility
      }}
      onClick={() => onClick(vessel)}
      title={`${vessel.vesselName} (${vessel.status})\nMeters: ${vessel.position.startMeter}-${vessel.position.endMeter}`}
    >
      <div className={styles.vesselName}>{vessel.vesselName}</div>
      <div>LOA: {vessel.loa}m</div>
      {vessel.position.loaMismatch && (
        <span className={styles.loaMismatchAlert}>Mismatch</span>
      )}
    </div>
  );
}
