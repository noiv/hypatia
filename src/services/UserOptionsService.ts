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
}

let cachedOptions: UserOptions | null = null;

/**
 * Load user options from public/user.options.json
 */
export async function getUserOptions(): Promise<UserOptions> {
  if (cachedOptions) {
    return cachedOptions;
  }

  try {
    const response = await fetch('/user.options.json');
    if (!response.ok) {
      throw new Error(`Failed to load user options: ${response.statusText}`);
    }

    cachedOptions = await response.json();
    console.log('📋 User options loaded:', cachedOptions);
    return cachedOptions!;
  } catch (error) {
    console.warn('Failed to load user options, using defaults:', error);

    // Return defaults
    cachedOptions = {
      timeServer: {
        enabled: false
      }
    };

    return cachedOptions;
  }
}
