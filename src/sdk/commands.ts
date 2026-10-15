import type CloudTAKAPI from './api.js';

/**
 * Base class for a group of CloudTAK API operations
 */
export default class Commands {
    api: CloudTAKAPI;

    constructor(api: CloudTAKAPI) {
        this.api = api;
    }

    /**
     * Resolve an API path against the base URL, appending query parameters -
     * array values are repeated, `undefined` & `null` values are skipped
     */
    url(path: string, query: Record<string, unknown> = {}): URL {
        const url = new URL(path, this.api.url);

        for (const [key, value] of Object.entries(query)) {
            if (value === undefined || value === null) continue;

            for (const v of Array.isArray(value) ? value : [value]) {
                url.searchParams.append(key, String(v));
            }
        }

        return url;
    }
}
