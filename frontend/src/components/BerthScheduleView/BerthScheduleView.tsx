import styles from './BerthScheduleView.module.css';

/**
 * BerthScheduleView
 *
 * Placeholder container for the 2D berth schedule visualization
 * (e.g. berths as horizontal lanes, vessels positioned along a time
 * axis using the backend's PositionEngine output).
 *
 * No rendering logic has been implemented yet — this only reserves
 * the layout area so the visualization can be built next.
 */
export function BerthScheduleView() {
  return (
    <div className={styles.container}>
      <div className={styles.placeholder}>
        2D Berth Schedule visualization will render here.
      </div>
    </div>
  );
}
