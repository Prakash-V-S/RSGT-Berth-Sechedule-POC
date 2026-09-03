"use client";

import React, { useEffect, useState, useMemo } from 'react';
import { ScheduleResponse, PositionedVesselSchedule } from '../../types/berth-schedule';
import { fetchBerthSchedule } from '../../services/berth-schedule-api';
import { VesselBlock } from './VesselBlock';
import { VesselDetailsModal } from './VesselDetailsModal';
import styles from './BerthSchedule.module.css';

const PIXELS_PER_METER = 2;
const PIXELS_PER_HOUR = 60;

export default function BerthSchedule() {
  const [scheduleData, setScheduleData] = useState<ScheduleResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedVessel, setSelectedVessel] = useState<PositionedVesselSchedule | null>(null);
  const [currentTimeMs, setCurrentTimeMs] = useState<number>(Date.now());

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchBerthSchedule();
      setScheduleData(data);
    } catch (err: any) {
      setError(err.message || 'An unknown error occurred');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    
    // Update current time indicator every minute
    const interval = setInterval(() => setCurrentTimeMs(Date.now()), 60000);
    return () => clearInterval(interval);
  }, []);

  // Calculate timeline boundaries based on valid vessels
  const { minTime, maxTime, totalHours } = useMemo(() => {
    if (!scheduleData || scheduleData.vessels.length === 0) {
      // Default to current time +- 12 hours if no vessels
      const now = Date.now();
      const start = now - 12 * 60 * 60 * 1000;
      const end = now + 12 * 60 * 60 * 1000;
      // Snap start to start of the hour
      const minT = new Date(start).setMinutes(0, 0, 0);
      return { minTime: minT, maxTime: end, totalHours: 24 };
    }

    let min = Infinity;
    let max = -Infinity;

    scheduleData.vessels.forEach(v => {
      const s = new Date(v.position.startTime).getTime();
      const e = new Date(v.position.endTime).getTime();
      if (s < min) min = s;
      if (e > max) max = e;
    });

    // Add some padding (e.g. 2 hours before and after)
    min -= 2 * 60 * 60 * 1000;
    max += 2 * 60 * 60 * 1000;
    
    // Snap minTime to start of the hour
    min = new Date(min).setMinutes(0, 0, 0);

    const hours = Math.ceil((max - min) / (1000 * 60 * 60));
    return { minTime: min, maxTime: max, totalHours: hours };
  }, [scheduleData]);

  if (loading) {
    return <div className={styles.loadingState}>Loading Berth Schedule...</div>;
  }

  if (error) {
    return (
      <div className={styles.errorState}>
        <div>
          <h3>Error loading schedule</h3>
          <p>{error}</p>
          <button onClick={loadData} className={styles.refreshButton}>Retry</button>
        </div>
      </div>
    );
  }

  if (!scheduleData) {
    return <div className={styles.emptyState}>No vessel schedule data available.</div>;
  }

  const berthLength = scheduleData.berth.length;
  const gridWidth = berthLength * PIXELS_PER_METER;
  const gridHeight = totalHours * PIXELS_PER_HOUR;

  // Generate Berth Axis Markers (every 100m)
  const berthMarkers = [];
  for (let i = 0; i <= berthLength; i += 100) {
    berthMarkers.push(i);
  }

  // Generate Time Axis Markers (every hour)
  const timeMarkers = [];
  for (let i = 0; i <= totalHours; i++) {
    timeMarkers.push(new Date(minTime + i * 60 * 60 * 1000));
  }

  const renderCurrentTimeLine = () => {
    if (currentTimeMs < minTime || currentTimeMs > maxTime) return null;
    const top = ((currentTimeMs - minTime) / (1000 * 60 * 60)) * PIXELS_PER_HOUR;
    return (
      <div 
        style={{
          position: 'absolute',
          top: `${top}px`,
          left: 0,
          right: 0,
          borderTop: '2px solid red',
          zIndex: 4,
          pointerEvents: 'none',
        }}
      >
        <span style={{ color: 'red', fontSize: '10px', position: 'absolute', right: '5px', top: '-15px', backgroundColor: 'rgba(255,255,255,0.7)' }}>
          Current Time
        </span>
      </div>
    );
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>RSGT Berth Schedule</h1>
        <div>
          <button onClick={loadData} className={styles.refreshButton}>Refresh</button>
        </div>
      </div>

      <div className={styles.legend}>
        <div className={styles.legendItem}>
          <div className={`${styles.legendBox} ${styles.inbound}`}></div>
          <span>Inbound</span>
        </div>
        <div className={styles.legendItem}>
          <div className={`${styles.legendBox} ${styles.working}`}></div>
          <span>Working</span>
        </div>
      </div>

      <div className={styles.timelineWrapper}>
        <div 
          className={styles.timelineInner} 
          style={{ width: gridWidth + 60, height: gridHeight + 40 }}
        >
          {/* Berth Axis (X) */}
          <div className={styles.berthAxis} style={{ left: 60, width: gridWidth }}>
            {berthMarkers.map(marker => (
              <div 
                key={marker} 
                className={styles.berthMarker} 
                style={{ left: marker * PIXELS_PER_METER }}
              >
                {marker}m
              </div>
            ))}
          </div>

          {/* Time Axis (Y) */}
          <div className={styles.timeAxis} style={{ top: 40, height: gridHeight }}>
            {timeMarkers.map((time, idx) => (
              <div 
                key={idx} 
                className={styles.timeMarker} 
                style={{ top: idx * PIXELS_PER_HOUR }}
              >
                {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            ))}
          </div>

          {/* Main Grid Area */}
          <div 
            className={styles.gridArea} 
            style={{ width: gridWidth, height: gridHeight }}
          >
            {/* Background Grid Lines */}
            {berthMarkers.map(marker => (
              <div 
                key={`v-grid-${marker}`} 
                className={styles.verticalGridLine}
                style={{ left: marker * PIXELS_PER_METER }}
              />
            ))}
            {timeMarkers.map((_, idx) => (
              <div 
                key={`h-grid-${idx}`} 
                className={styles.horizontalGridLine}
                style={{ top: idx * PIXELS_PER_HOUR }}
              />
            ))}

            {/* Current Time Indicator */}
            {renderCurrentTimeLine()}

            {/* Vessel Blocks */}
            {scheduleData.vessels.map((vessel, idx) => (
              <VesselBlock 
                key={`${vessel.vesselName}-${idx}`}
                vessel={vessel}
                minTime={minTime}
                pixelsPerMeter={PIXELS_PER_METER}
                pixelsPerHour={PIXELS_PER_HOUR}
                onClick={setSelectedVessel}
              />
            ))}

            {scheduleData.vessels.length === 0 && (
              <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: '#999' }}>
                No valid vessels on the schedule
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Errors Section */}
      {scheduleData.errors && scheduleData.errors.length > 0 && (
        <div className={styles.errorsSection}>
          <h3 className={styles.errorsTitle}>Data Quality Issues ({scheduleData.errors.length})</h3>
          <ul className={styles.errorList}>
            {scheduleData.errors.map((error, idx) => (
              <li key={idx} className={styles.errorItem}>
                <span className={styles.errorVesselName}>{error.vesselName}:</span>
                <span>{error.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Details Modal */}
      {selectedVessel && (
        <VesselDetailsModal 
          vessel={selectedVessel} 
          onClose={() => setSelectedVessel(null)} 
        />
      )}
    </div>
  );
}
