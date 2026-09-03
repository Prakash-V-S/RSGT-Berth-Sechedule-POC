import React from 'react';
import { PositionedVesselSchedule } from '../../types/berth-schedule';
import styles from './BerthSchedule.module.css';

interface VesselDetailsModalProps {
  vessel: PositionedVesselSchedule;
  onClose: () => void;
}

export function VesselDetailsModal({ vessel, onClose }: VesselDetailsModalProps) {
  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h3>{vessel.vesselName}</h3>
          <button className={styles.closeButton} onClick={onClose}>&times;</button>
        </div>
        <div className={styles.modalBody}>
          <p><strong>Status:</strong> {vessel.status}</p>
          <p><strong>LOA:</strong> {vessel.loa}m {vessel.position.loaMismatch && '(Mismatch with Meter Occupancy)'}</p>
          <p><strong>Start Meter:</strong> {vessel.position.startMeter}m</p>
          <p><strong>End Meter:</strong> {vessel.position.endMeter}m</p>
          <p><strong>Occupied Length:</strong> {vessel.position.occupiedLength}m</p>
          <hr />
          <p><strong>Start Time:</strong> {new Date(vessel.position.startTime).toLocaleString()}</p>
          <p><strong>End Time:</strong> {new Date(vessel.position.endTime).toLocaleString()}</p>
          {vessel.eta && <p><strong>ETA:</strong> {new Date(vessel.eta).toLocaleString()}</p>}
          {vessel.ata && <p><strong>ATA:</strong> {new Date(vessel.ata).toLocaleString()}</p>}
          {vessel.etd && <p><strong>ETD:</strong> {new Date(vessel.etd).toLocaleString()}</p>}
        </div>
      </div>
    </div>
  );
}
