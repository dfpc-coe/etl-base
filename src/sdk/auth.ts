import jwt from 'jsonwebtoken';
import { fetch } from '@tak-ps/node-safeurl';
import type { FetchInit, TypedResponse } from '@tak-ps/node-safeurl';
import type CloudTAKAPI from './api.js';

/** Secret a local CloudTAK dev server signs Layer tokens with when no `StackName` secret is configured */
export const DEFAULT_LAYER_SECRET = 'coe-wildland-fire';

/**
 * Base authentication strategy - requests are sent without credentials
 *
 * Extend this class to add credentials to every request made by a {@link CloudTAKAPI}
 */
export class APIAuth {
    /**
     * Called once by {@link CloudTAKAPI.init} - exchange credentials for a token here
     */
    async init(api: CloudTAKAPI): Promise<void> { // eslint-disable-line @typescript-eslint/no-unused-vars

    }

    async fetch(api: CloudTAKAPI, url: URL, opts: FetchInit): Promise<TypedResponse> {
        return await fetch(url, {
            ...opts,
            safeUrlAllow: [api.url.origin]
        });
    }
}

/**
 * Bearer token authentication
 *
 * Accepts any token CloudTAK issues: a User JWT, a Connection token or a Layer token (`etl.<jwt>`)
 */
export class APIAuthToken extends APIAuth {
    token: string;

    constructor(token: string) {
        super();
        this.token = token;
    }

    async fetch(api: CloudTAKAPI, url: URL, opts: FetchInit): Promise<TypedResponse> {
        const headers = opts.headers as Record<string, string> | undefined;

        if (!headers || !headers['Authorization']) {
            opts.headers = {
                ...(headers || {}),
                Authorization: `Bearer ${this.token}`
            };
        }

        return await super.fetch(api, url, opts);
    }
}

/**
 * Layer token signed locally - for development against a CloudTAK running on localhost
 *
 * A deployed ETL receives its Layer token via `ETL_TOKEN`; use {@link APIAuthToken} there
 */
export class APIAuthLayer extends APIAuthToken {
    layer: number;

    constructor(layer: number, secret: string = DEFAULT_LAYER_SECRET) {
        super(APIAuthLayer.sign(layer, secret));
        this.layer = layer;
    }

    /**
     * Sign an `etl.<jwt>` Layer token the way the CloudTAK API does
     */
    static sign(layer: number, secret: string = DEFAULT_LAYER_SECRET): string {
        return `etl.${jwt.sign({
            access: 'layer',
            id: layer,
            internal: true
        }, secret)}`;
    }
}
