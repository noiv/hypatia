/**
 * Event Manager Service
 *
 * Centralizes event listener registration and cleanup.
 * Prevents memory leaks by automatically tracking all event listeners
 * and removing them on dispose.
 */

interface EventRegistration {
  element: EventTarget;
  event: string;
  handler: EventListener;
  options: AddEventListenerOptions | undefined;
}

export class EventManagerService {
  private registrations: EventRegistration[] = [];

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
