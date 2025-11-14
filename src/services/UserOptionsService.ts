/**
 * User Options Service
 *
 * Loads and manages user preferences from user.options.json
 */

export interface UserOptions {
  timeServer: {
    enabled: boolean;
    comment?: string;
  };
  atmosphere: {
    enabled: boolean;
    comment?: string;
  };
}

const defaults = {
      timeServer: {
        enabled: false
      },
      atmosphere: {
        enabled: false
      }
    }

let options: UserOptions | null = null;

/**
 * Load user options from public/config/user.options.json
 */
export async function getUserOptions(): Promise<UserOptions> {
  if (options) {
    return options;
  }

  try {
    const response = await fetch('/config/user.options.json');
    if (!response.ok) {
      throw new Error(`Failed to load user options: ${response.statusText}`);
    }

    options = await response.json();
    console.log('User options loaded:', options);
    return options ?? defaults;

  } catch (error) {
    console.warn('Failed to load user options, using defaults:', error);
    return options = defaults;

  }
}
