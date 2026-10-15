import Commands from '../commands.js';
import type {
    StandardResponse,
    CoreEvent,
    CoreEventList,
    CoreEventListQuery,
    CoreEventCreate,
    CoreEventUpdate,
    CoreDevice,
    CoreDeviceList,
    CoreDeviceListQuery,
    CoreDeviceCreate,
    CoreDeviceUpdate
} from './types.js';

/**
 * Kinds of Core Entity - each kind is served by its own `/api/core/<kind>` routes
 */
export enum EntityKind {
    EVENT = 'event',
    DEVICE = 'device'
}

export type CoreEntity<K extends EntityKind = EntityKind> =
    K extends EntityKind.EVENT ? CoreEvent :
    K extends EntityKind.DEVICE ? CoreDevice :
    never;

export type CoreEntityList<K extends EntityKind = EntityKind> =
    K extends EntityKind.EVENT ? CoreEventList :
    K extends EntityKind.DEVICE ? CoreDeviceList :
    never;

export type CoreEntityListQuery<K extends EntityKind = EntityKind> =
    K extends EntityKind.EVENT ? CoreEventListQuery :
    K extends EntityKind.DEVICE ? CoreDeviceListQuery :
    never;

export type CoreEntityCreate<K extends EntityKind = EntityKind> =
    K extends EntityKind.EVENT ? CoreEventCreate :
    K extends EntityKind.DEVICE ? CoreDeviceCreate :
    never;

export type CoreEntityUpdate<K extends EntityKind = EntityKind> =
    K extends EntityKind.EVENT ? CoreEventUpdate :
    K extends EntityKind.DEVICE ? CoreDeviceUpdate :
    never;

/**
 * CRUD operations shared by every kind of Core Entity
 *
 * CloudTAK exposes no `/api/core/entity` route - an Entity is always addressed
 * by its kind, so each operation takes the {@link EntityKind} first. The
 * {@link EventCommands} and {@link DeviceCommands} groups fix the kind for you.
 */
export default class EntityCommands extends Commands {
    static path(kind: EntityKind, id?: string): string {
        const base = `/api/core/${kind}`;

        return id === undefined ? base : `${base}/${encodeURIComponent(id)}`;
    }

    /**
     * List Entities of a kind visible to the caller
     *
     * Layer tokens require `<kind>:read`
     */
    async list<K extends EntityKind>(
        kind: K,
        query: Partial<CoreEntityListQuery<K>> = {}
    ): Promise<CoreEntityList<K>> {
        const url = this.url(EntityCommands.path(kind), query as Record<string, unknown>);

        return await this.api.fetch<CoreEntityList<K>>(url);
    }

    /**
     * Get a single Entity
     *
     * Layer tokens require `<kind>:read`
     */
    async get<K extends EntityKind>(
        kind: K,
        id: string
    ): Promise<CoreEntity<K>> {
        const url = new URL(EntityCommands.path(kind, id), this.api.url);

        return await this.api.fetch<CoreEntity<K>>(url);
    }

    /**
     * Create an Entity
     *
     * Layer tokens require `<kind>:create`
     */
    async create<K extends EntityKind>(
        kind: K,
        body: CoreEntityCreate<K>
    ): Promise<CoreEntity<K>> {
        const url = new URL(EntityCommands.path(kind), this.api.url);

        return await this.api.fetch<CoreEntity<K>>(url, {
            method: 'POST',
            body
        });
    }

    /**
     * Update properties of an Entity - only the fields provided are changed
     *
     * Layer tokens require `<kind>:update` and may only update Entities their Connection created
     */
    async update<K extends EntityKind>(
        kind: K,
        id: string,
        body: CoreEntityUpdate<K>
    ): Promise<CoreEntity<K>> {
        const url = new URL(EntityCommands.path(kind, id), this.api.url);

        return await this.api.fetch<CoreEntity<K>>(url, {
            method: 'PATCH',
            body
        });
    }

    /**
     * Delete an Entity
     *
     * Layer tokens require `<kind>:delete` and may only delete Entities their Connection created
     */
    async delete(
        kind: EntityKind,
        id: string
    ): Promise<StandardResponse> {
        const url = new URL(EntityCommands.path(kind, id), this.api.url);

        return await this.api.fetch<StandardResponse>(url, {
            method: 'DELETE'
        });
    }
}
