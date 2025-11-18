/**
 * Keyboard Shortcuts Service
 *
 * Handles all keyboard shortcuts for the application:
 * - Arrow keys: Time navigation (hour/10-min/24-hour jumps)
 * - F: Toggle fullscreen
 * - Cmd/Ctrl +/-/0: Text size adjustment
 */

import { configLoader } from '../config';
import type { DateTimeService } from './DateTimeService';

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
    private handlers: KeyboardShortcutHandlers,
    private dateTimeService: DateTimeService
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
      const currentTime = this.getCurrentTime();
      const maxRangeDays = configLoader.getHypatiaConfig().data.maxRangeDays;
      const clampedTime = clampTimeToDataWindow(newTime, currentTime, maxRangeDays);
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
      // Ctrl/Cmd + Arrow: Jump by 24 hours (UTC)
      return this.dateTimeService.addDays(currentTime, direction);
    }

    if (e.shiftKey) {
      // Shift + Arrow: Jump to next full 10 minutes (UTC)
      return this.dateTimeService.roundToTenMinutes(currentTime, direction as 1 | -1);
    }

    // Arrow alone: Jump to next full hour (UTC)
    return this.dateTimeService.roundToHour(currentTime, direction as 1 | -1);
  }

  // Removed: calculateTenMinuteJump() and calculateHourJump() - now using utils/timeUtils.ts
  // This ensures UTC-only operations everywhere
}
