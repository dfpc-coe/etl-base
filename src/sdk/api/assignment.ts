import Commands from '../commands.js';
import { EntityKind } from './entity.js';
import type {
    StandardResponse,
    CoreEventAssignment,
    CoreEventAssignmentList,
    CoreEventAssignmentListQuery,
    CoreEventAssignmentCreate,
    CoreEventAssignmentUpdate
} from './types.js';

/**
 * People assigned to a Core Event - `/api/core/event/:event/assignment`
 *
 * An assignee is a name & role, optionally linked to a CloudTAK user by `uid`
 */
export default class AssignmentCommands extends Commands {
    static path(event: string, id?: string): string {
        const base = `/api/core/${EntityKind.EVENT}/${encodeURIComponent(event)}/assignment`;

        return id === undefined ? base : `${base}/${encodeURIComponent(id)}`;
    }

    /**
     * List the people assigned to an Event
     *
     * Layer tokens require `event:read` & `assignment:read`
     */
    async list(
        event: string,
        query: Partial<CoreEventAssignmentListQuery> = {}
    ): Promise<CoreEventAssignmentList> {
        return await this.api.fetch<CoreEventAssignmentList>(this.url(AssignmentCommands.path(event), query));
    }

    /**
     * Get a person assigned to an Event
     *
     * Layer tokens require `event:read` & `assignment:read`
     */
    async get(event: string, id: string): Promise<CoreEventAssignment> {
        return await this.api.fetch<CoreEventAssignment>(this.url(AssignmentCommands.path(event, id)));
    }

    /**
     * Assign a person to an Event
     *
     * Layer tokens require `event:update` & `assignment:create`
     */
    async create(event: string, body: CoreEventAssignmentCreate): Promise<CoreEventAssignment> {
        return await this.api.fetch<CoreEventAssignment>(this.url(AssignmentCommands.path(event)), {
            method: 'POST',
            body
        });
    }

    /**
     * Update a person assigned to an Event - only the fields provided are changed
     *
     * Layer tokens require `event:update` & `assignment:update`
     */
    async update(event: string, id: string, body: CoreEventAssignmentUpdate): Promise<CoreEventAssignment> {
        return await this.api.fetch<CoreEventAssignment>(this.url(AssignmentCommands.path(event, id)), {
            method: 'PATCH',
            body
        });
    }

    /**
     * Remove a person assigned to an Event
     *
     * Layer tokens require `event:update` & `assignment:delete`
     */
    async delete(event: string, id: string): Promise<StandardResponse> {
        return await this.api.fetch<StandardResponse>(this.url(AssignmentCommands.path(event, id)), {
            method: 'DELETE'
        });
    }
}
