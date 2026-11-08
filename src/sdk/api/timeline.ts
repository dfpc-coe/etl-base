import Commands from '../commands.js';
import type {
    StandardResponse,
    CoreEntityTimeline,
    CoreEntityTimelineList,
    CoreEntityTimelineListQuery,
    CoreEntityTimelineInput,
    CoreEntityTimelineUpsert,
    CoreEntityTimelineUpdate
} from './types.js';

/**
 * Timeline entries of a Core Entity - `/api/core/entity/:entity/timeline`
 *
 * A dated narrative of comments, unit statuses, location fixes, etc. on an Event
 * or Device. The route is kind-agnostic - every method also requires `event:read`
 * or `device:read` for the kind of the Entity
 */
export default class TimelineCommands extends Commands {
    /** Most entries the API accepts in one {@link upsert} call */
    static UPSERT_MAX = 1000;

    static path(entity: string, entry?: string): string {
        const base = `/api/core/entity/${encodeURIComponent(entity)}/timeline`;

        return entry === undefined ? base : `${base}/${encodeURIComponent(entry)}`;
    }

    /**
     * List the Timeline entries of an Entity, newest first by default
     *
     * Layer tokens require `timeline:read`
     */
    async list(
        entity: string,
        query: Partial<CoreEntityTimelineListQuery> = {}
    ): Promise<CoreEntityTimelineList> {
        return await this.api.fetch<CoreEntityTimelineList>(this.url(TimelineCommands.path(entity), query));
    }

    /**
     * Get a Timeline entry
     *
     * Layer tokens require `timeline:read`
     */
    async get(entity: string, entry: string): Promise<CoreEntityTimeline> {
        return await this.api.fetch<CoreEntityTimeline>(this.url(TimelineCommands.path(entity, entry)));
    }

    /**
     * Add a Timeline entry - an `external_id` already present on the Entity is rejected
     *
     * Layer tokens require `timeline:create`
     */
    async create(entity: string, body: CoreEntityTimelineInput): Promise<CoreEntityTimeline> {
        return await this.api.fetch<CoreEntityTimeline>(this.url(TimelineCommands.path(entity)), {
            method: 'POST',
            body
        });
    }

    /**
     * Add many Timeline entries in one call - entries whose `external_id` is
     * already present on the Entity are updated in place, so a source that is
     * replayed in full on every poll never duplicates an entry. At most
     * {@link UPSERT_MAX} entries are accepted per call
     *
     * Layer tokens require `timeline:create`
     */
    async upsert(entity: string, entries: CoreEntityTimelineInput[]): Promise<CoreEntityTimelineUpsert> {
        return await this.api.fetch<CoreEntityTimelineUpsert>(this.url(TimelineCommands.path(entity)), {
            method: 'PUT',
            body: { entries }
        });
    }

    /**
     * Update a Timeline entry - only the fields provided are changed
     *
     * Layer tokens require `timeline:update`
     */
    async update(entity: string, entry: string, body: CoreEntityTimelineUpdate): Promise<CoreEntityTimeline> {
        return await this.api.fetch<CoreEntityTimeline>(this.url(TimelineCommands.path(entity, entry)), {
            method: 'PATCH',
            body
        });
    }

    /**
     * Remove a Timeline entry
     *
     * Layer tokens require `timeline:delete`
     */
    async delete(entity: string, entry: string): Promise<StandardResponse> {
        return await this.api.fetch<StandardResponse>(this.url(TimelineCommands.path(entity, entry)), {
            method: 'DELETE'
        });
    }
}
