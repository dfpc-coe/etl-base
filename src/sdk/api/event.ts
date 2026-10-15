import Commands from '../commands.js';
import { EntityKind } from './entity.js';
import type {
    StandardResponse,
    CoreEvent,
    CoreEventList,
    CoreEventListQuery,
    CoreEventCreate,
    CoreEventUpdate
} from './types.js';

/**
 * Core Event operations - `/api/core/event`
 */
export default class EventCommands extends Commands {
    /**
     * List Events visible to the caller
     *
     * Layer tokens require `event:read`
     */
    async list(query: Partial<CoreEventListQuery> = {}): Promise<CoreEventList> {
        return await this.api.Entity.list(EntityKind.EVENT, query);
    }

    /**
     * Get a single Event
     *
     * Layer tokens require `event:read`
     */
    async get(id: string): Promise<CoreEvent> {
        return await this.api.Entity.get(EntityKind.EVENT, id);
    }

    /**
     * Create an Event
     *
     * Layer tokens require `event:create`
     */
    async create(body: CoreEventCreate): Promise<CoreEvent> {
        return await this.api.Entity.create(EntityKind.EVENT, body);
    }

    /**
     * Update properties of an Event - only the fields provided are changed
     *
     * Layer tokens require `event:update`
     */
    async update(id: string, body: CoreEventUpdate): Promise<CoreEvent> {
        return await this.api.Entity.update(EntityKind.EVENT, id, body);
    }

    /**
     * Delete an Event
     *
     * Layer tokens require `event:delete`
     */
    async delete(id: string): Promise<StandardResponse> {
        return await this.api.Entity.delete(EntityKind.EVENT, id);
    }
}
