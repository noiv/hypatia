/**
 * Keyboard Shortcuts Service
 *
 * Handles all keyboard shortcuts for the application:
 * - Arrow keys: Time navigation (hour/10-min/24-hour jumps)
 * - F: Toggle fullscreen
 * - Cmd/Ctrl +/-/0: Text size adjustment
 */

import { clampTimeToDataRange } from '../utils/timeUtils';

export interface KeyboardShortcutHandlers {
  onTimeChange: (newTime: Date) => void;
  onFullscreenToggle: () => void;
  onTextSizeIncrease: () => void;
  onTextSizeDecrease: () => void;
  onTextSizeReset: () => void;
}

export class KeyboardShortcutsService {
  constructor(
    private getCurrentTime: () => Date,
    private handlers: KeyboardShortcutHandlers
  ) {}

  /**
   * Handle keyboard events
   * Use as: this.keyboardShortcuts.handleKeydown
   */
  handleKeydown = (e: KeyboardEvent): void => {
    // Arrow keys: time navigation
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      e.preventDefault();
      const newTime = this.calculateTimeFromArrowKey(e);
      const clampedTime = clampTimeToDataRange(newTime);
      this.handlers.onTimeChange(clampedTime);
    }

    // F: toggle fullscreen
    if (e.code === 'KeyF') {
      e.preventDefault();
      this.handlers.onFullscreenToggle();
    }

    // Text size shortcuts: Cmd/Ctrl +/-/0
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey) {
      if (e.code === 'Equal' || e.code === 'NumpadAdd') {
        e.preventDefault();
        this.handlers.onTextSizeIncrease();
      } else if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
        e.preventDefault();
        this.handlers.onTextSizeDecrease();
      } else if (e.code === 'Digit0' || e.code === 'Numpad0') {
        e.preventDefault();
        this.handlers.onTextSizeReset();
      }
    }
  };

  /**
   * Calculate new time based on arrow key modifiers
   * - Ctrl/Cmd + Arrow: 24 hours
   * - Shift + Arrow: 10 minutes
   * - Arrow alone: 1 hour
   */
  private calculateTimeFromArrowKey(e: KeyboardEvent): Date {
    const currentTime = this.getCurrentTime();
    const direction = e.code === 'ArrowLeft' ? -1 : 1;

    if (e.ctrlKey || e.metaKey) {
      // Ctrl/Cmd + Arrow: Jump by 24 hours
      return new Date(currentTime.getTime() + direction * 24 * 60 * 60 * 1000);
    }

    if (e.shiftKey) {
      // Shift + Arrow: Jump to next full 10 minutes
      return this.calculateTenMinuteJump(currentTime, direction);
    }

    // Arrow alone: Jump to next full hour
    return this.calculateHourJump(currentTime, direction);
  }

  /**
   * Jump to next/previous 10-minute mark
   */
  private calculateTenMinuteJump(time: Date, direction: number): Date {
    const minutes = time.getMinutes();
    const seconds = time.getSeconds();
    const milliseconds = time.getMilliseconds();

    // Calculate how many minutes to next 10-minute mark
    const currentMinuteInCycle = minutes % 10;
    let minutesToAdd: number;

    if (direction > 0) {
      // Forward: go to next 10-minute mark
      minutesToAdd = currentMinuteInCycle === 0 && seconds === 0 && milliseconds === 0
        ? 10  // Already on mark, go to next
        : 10 - currentMinuteInCycle;
    } else {
      // Backward: go to previous 10-minute mark
      minutesToAdd = currentMinuteInCycle === 0 && seconds === 0 && milliseconds === 0
        ? -10  // Already on mark, go to previous
        : -currentMinuteInCycle;
    }

    const newTime = new Date(time);
    newTime.setMinutes(minutes + minutesToAdd, 0, 0);
    return newTime;
  }

  /**
   * Jump to next/previous full hour
   */
  private calculateHourJump(time: Date, direction: number): Date {
    const minutes = time.getMinutes();
    const seconds = time.getSeconds();
    const milliseconds = time.getMilliseconds();

    if (direction > 0) {
      // Forward: go to next full hour
      if (minutes === 0 && seconds === 0 && milliseconds === 0) {
        // Already on full hour, go to next hour
        return new Date(time.getTime() + 60 * 60 * 1000);
      } else {
        // Round up to next hour
        const newTime = new Date(time);
        newTime.setHours(time.getHours() + 1, 0, 0, 0);
        return newTime;
      }
    } else {
      // Backward: go to previous full hour
      if (minutes === 0 && seconds === 0 && milliseconds === 0) {
        // Already on full hour, go to previous hour
        return new Date(time.getTime() - 60 * 60 * 1000);
      } else {
        // Round down to current hour
        const newTime = new Date(time);
        newTime.setMinutes(0, 0, 0);
        return newTime;
      }
    }
  }
}
