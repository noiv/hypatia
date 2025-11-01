/**
 * Wheel Gesture Detector
 *
 * Detects and locks wheel gesture direction (vertical/horizontal) based on first event.
 * Used by App (horizontal = time scroll) and Scene (vertical = zoom).
 *
 * Design: First wheel event determines gesture direction, which is then locked
 * for the duration of the gesture (until timeout expires).
 */

export type GestureDirection = 'none' | 'vertical' | 'horizontal';

export interface WheelGestureDetectorOptions {
  /**
   * Timeout in milliseconds before resetting gesture mode
   * @default 100
   */
  timeoutMs?: number;

  /**
   * Callback invoked when gesture mode resets to 'none'
   */
  onReset?: () => void;
}

export class WheelGestureDetector {
  private gestureMode: GestureDirection = 'none';
  private gestureTimeout: number | null = null;
  private timeoutMs: number;
  private onReset?: (() => void) | undefined;

  constructor(options: WheelGestureDetectorOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 100;
    this.onReset = options.onReset;
  }

  /**
   * Detect gesture direction from wheel event
   * @param e WheelEvent
   * @returns Current gesture direction ('vertical', 'horizontal', or 'none')
   */
  detect(e: WheelEvent): GestureDirection {
    const absY = Math.abs(e.deltaY);
    const absX = Math.abs(e.deltaX);

    // Clear existing timeout
    if (this.gestureTimeout !== null) {
      clearTimeout(this.gestureTimeout);
    }

    // Determine gesture mode only on first event (lock it in)
    if (this.gestureMode === 'none') {
      if (absX > absY) {
        this.gestureMode = 'horizontal';
      } else {
        this.gestureMode = 'vertical';
      }
    }

    // Set timeout to reset gesture mode
    this.gestureTimeout = window.setTimeout(() => {
      this.gestureMode = 'none';
      this.gestureTimeout = null;

      // Invoke reset callback if provided
      if (this.onReset) {
        this.onReset();
      }
    }, this.timeoutMs);

    return this.gestureMode;
  }

  /**
   * Get current gesture mode without processing an event
   */
  getMode(): GestureDirection {
    return this.gestureMode;
  }

  /**
   * Manually reset gesture mode (clears timeout)
   */
  reset(): void {
    if (this.gestureTimeout !== null) {
      clearTimeout(this.gestureTimeout);
      this.gestureTimeout = null;
    }
    this.gestureMode = 'none';

    if (this.onReset) {
      this.onReset();
    }
  }

  /**
   * Clean up (clear timeout)
   */
  dispose(): void {
    if (this.gestureTimeout !== null) {
      clearTimeout(this.gestureTimeout);
      this.gestureTimeout = null;
    }
  }
}
