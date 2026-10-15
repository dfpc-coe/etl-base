import Commands from '../commands.js';
import { EntityKind } from './entity.js';
import type {
    StandardResponse,
    CoreDevice,
    CoreDeviceList,
    CoreDeviceListQuery,
    CoreDeviceCreate,
    CoreDeviceUpdate
} from './types.js';

/**
 * Core Device operations - `/api/core/device`
 */
export default class DeviceCommands extends Commands {
    /**
     * List Devices visible to the caller
     *
     * Layer tokens require `device:read` and only see Devices of their own Connection
     */
    async list(query: Partial<CoreDeviceListQuery> = {}): Promise<CoreDeviceList> {
        return await this.api.Entity.list(EntityKind.DEVICE, query);
    }

    /**
     * Get a single Device
     *
     * Layer tokens require `device:read`
     */
    async get(id: string): Promise<CoreDevice> {
        return await this.api.Entity.get(EntityKind.DEVICE, id);
    }

    /**
     * Create a Device
     *
     * Layer tokens require `device:create`
     */
    async create(body: CoreDeviceCreate): Promise<CoreDevice> {
        return await this.api.Entity.create(EntityKind.DEVICE, body);
    }

    /**
     * Update properties of a Device - only the fields provided are changed
     *
     * Layer tokens require `device:update`
     */
    async update(id: string, body: CoreDeviceUpdate): Promise<CoreDevice> {
        return await this.api.Entity.update(EntityKind.DEVICE, id, body);
    }

    /**
     * Delete a Device
     *
     * Layer tokens require `device:delete`
     */
    async delete(id: string): Promise<StandardResponse> {
        return await this.api.Entity.delete(EntityKind.DEVICE, id);
    }
}
