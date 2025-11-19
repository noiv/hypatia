/**
 * Event Service
 *
 * Centralizes all event handling for the application:
 * - Event listener registration and cleanup (prevents memory leaks)
 * - Keyboard shortcuts (arrow keys, fullscreen, text size)
 * - Automatic tracking of all event listeners for cleanup
 */

import type { ConfigService } from './ConfigService';
import type { DateTimeService } from './DateTimeService';

interface EventRegistration {
  element: EventTarget;
  event: string;
  handler: EventListener;
  options: AddEventListenerOptions | undefined;
}

export interface KeyboardShortcutHandlers {
  onTimeChange: (newTime: Date) => void;
  onFullscreenToggle: () => void;
  onTextSizeIncrease: () => void;
  onTextSizeDecrease: () => void;
  onTextSizeReset: () => void;
}

export class EventService {
  private registrations: EventRegistration[] = [];

  constructor(
    private getCurrentTime: () => Date,
    private handlers: KeyboardShortcutHandlers,
    private dateTimeService: DateTimeService,
    // @ts-expect-error - Reserved for future use
    private configService: ConfigService
  ) {}

  /**
   * Register an event listener
   * Automatically tracks the registration for later cleanup
   */
  register(
    element: EventTarget,
    event: string,
    handler: EventListener,
    options?: AddEventListenerOptions
  ): void {
    element.addEventListener(event, handler, options);
    this.registrations.push({ element, event, handler, options: options });
  }

  /**
   * Handle keyboard events
   * Use as: this.eventService.handleKeydown
   */
  handleKeydown = (e: KeyboardEvent): void => {
    // Arrow keys: time navigation
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      e.preventDefault();
      const newTime = this.calculateTimeFromArrowKey(e);
      this.handlers.onTimeChange(newTime); // handleTimeChange will clamp to slider bounds
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

  /**
   * Remove all registered event listeners
   * Call this in component onremove/dispose
   */
  dispose(): void {
    for (const { element, event, handler } of this.registrations) {
      element.removeEventListener(event, handler);
    }
    this.registrations = [];
  }

  /**
   * Get count of registered event listeners (for debugging)
   */
  getRegistrationCount(): number {
    return this.registrations.length;
  }
}
