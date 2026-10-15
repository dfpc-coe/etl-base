import Err from '@openaddresses/batch-error';
import type { FetchInit, TypedResponse } from '@tak-ps/node-safeurl';
import { APIAuth, APIAuthToken } from './auth.js';
import Entity, { EntityKind } from './api/entity.js';
import Event from './api/event.js';
import Device from './api/device.js';
import Assignment from './api/assignment.js';

/**
 * Request options accepted by {@link CloudTAKAPI.fetch}
 *
 * A plain object or array `body` is JSON encoded and sent as `application/json`
 */
export type APIFetchInit = Omit<FetchInit, 'body' | 'headers'> & {
    body?: FetchInit['body'] | object;
    headers?: Record<string, string>;
};

/**
 * Handle CloudTAK HTTP API Operations
 *
 * ```typescript
 * const api = await CloudTAKAPI.init('https://cloudtak.example.com', new APIAuthToken(process.env.ETL_TOKEN));
 * const event = await api.Event.get('…');
 * ```
 *
 * @class
 */
export default class CloudTAKAPI {
    url: URL;
    auth: APIAuth;

    Entity: Entity;
    Event: Event;
    Device: Device;
    Assignment: Assignment;

    constructor(url: URL | string, auth: APIAuth = new APIAuth()) {
        this.url = url instanceof URL ? url : new URL(url);
        this.auth = auth;

        this.Entity = new Entity(this);
        this.Event = new Event(this);
        this.Device = new Device(this);
        this.Assignment = new Assignment(this);
    }

    /**
     * Create an API instance and let the auth strategy initialize itself
     */
    static async init(url: URL | string, auth: APIAuth = new APIAuth()): Promise<CloudTAKAPI> {
        const api = new CloudTAKAPI(url, auth);

        await api.auth.init(api);

        return api;
    }

    /**
     * Create an API instance from the `ETL_API` & `ETL_TOKEN` environment
     * variables the CloudTAK ETL server provides to every task
     */
    static fromEnv(env: Record<string, string | undefined> = process.env): CloudTAKAPI {
        if (!env.ETL_API) throw new Error('No ETL_API Provided');
        if (!env.ETL_TOKEN) throw new Error('No ETL_TOKEN Provided');

        return new CloudTAKAPI(new URL(env.ETL_API), new APIAuthToken(env.ETL_TOKEN));
    }

    /**
     * Resolve an API fragment (`/api/core/event`) against the base URL - full URLs pass through
     */
    stdurl(url: string | URL): URL {
        if (url instanceof URL) return url;

        try {
            return new URL(url);
        } catch {
            return new URL(url, this.url);
        }
    }

    /**
     * Standardize interactions with the CloudTAK API
     *
     * JSON responses are parsed, other responses are returned as text and
     * any non-2xx response is thrown as an `Err` carrying the API's status & message
     *
     * @param url  - Full URL or API fragment to request
     * @param opts - Fetch options
     */
    async fetch<T = unknown>(url: string | URL, opts: APIFetchInit = {}): Promise<T> {
        const headers: Record<string, string> = { ...(opts.headers || {}) };

        let body = opts.body;

        if (isPlainObject(body) || Array.isArray(body)) {
            body = JSON.stringify(body);

            if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
        }

        let res: TypedResponse;

        try {
            res = await this.auth.fetch(this, this.stdurl(url), {
                ...opts,
                headers,
                body: body as FetchInit['body']
            });
        } catch (err) {
            if (err instanceof Err) throw err;
            throw new Err(400, null, formatFetchError(err));
        }

        if (!res.ok) throw await CloudTAKAPI.error(res);

        if (res.status === 204) return undefined as T;

        const type = res.headers.get('content-type') || '';

        if (type.startsWith('application/json')) {
            return await res.json() as T;
        } else {
            return await res.text() as T;
        }
    }

    /**
     * Convert a non-2xx response into an `Err` - CloudTAK returns `{ status, message }` bodies
     */
    static async error(res: TypedResponse): Promise<Err> {
        let text: string;

        try {
            text = await res.text();
        } catch {
            text = '';
        }

        try {
            const json = JSON.parse(text);

            if (json && typeof json.message === 'string') {
                return new Err(res.status, null, json.message);
            }
        } catch {
            // Not a JSON body
        }

        return new Err(res.status, null, text || `Status Code: ${res.status}`);
    }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && value.constructor === Object;
}

type ErrorWithCause = Error & {
    code?: unknown;
    cause?: unknown;
};

/** Flatten a fetch failure and its `cause` chain into one message - the top level message is usually just "fetch failed" */
function formatFetchError(err: unknown): string {
    if (!(err instanceof Error)) return String(err);

    const messages = new Set<string>();

    const push = (value: unknown) => {
        if (!value) return;

        const message = String(value).trim();

        if (!message || message === 'fetch failed') return;

        messages.add(message);
    };

    let current: unknown = err;

    while (current instanceof Error) {
        const nested = current as ErrorWithCause;
        push(nested.code);
        push(nested.message);
        current = nested.cause;
    }

    if (current) push(current);

    if (messages.size) return Array.from(messages).join(': ');
    return err.message;
}

export {
    Entity,
    EntityKind,
    Event,
    Device,
    Assignment
};
