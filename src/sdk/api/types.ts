import type { paths } from '../../api-types.js';

type JSONContent<T> = T extends { content: { 'application/json': infer R } } ? R : never;

/**
 * JSON body of the 200 response of an operation in the CloudTAK OpenAPI document
 *
 * ```typescript
 * type Layer = APIResponse<'/api/layer/{:layerid}', 'get'>;
 * ```
 */
export type APIResponse<P extends keyof paths, M extends keyof paths[P]> =
    paths[P][M] extends { responses: { 200: infer R } } ? JSONContent<R> : never;

/**
 * JSON request body of an operation in the CloudTAK OpenAPI document
 */
export type APIBody<P extends keyof paths, M extends keyof paths[P]> =
    paths[P][M] extends { requestBody: infer B } ? JSONContent<B> : never;

/**
 * Query parameters of an operation in the CloudTAK OpenAPI document
 */
export type APIQuery<P extends keyof paths, M extends keyof paths[P]> =
    paths[P][M] extends { parameters: { query?: infer Q } } ? Exclude<Q, undefined> : never;

/** `{ status, message }` body returned by DELETE and other status-only operations */
export type StandardResponse = APIResponse<'/api/core/event/{:event}', 'delete'>;

export type CoreEvent = APIResponse<'/api/core/event/{:event}', 'get'>;
export type CoreEventList = APIResponse<'/api/core/event', 'get'>;
export type CoreEventListQuery = APIQuery<'/api/core/event', 'get'>;
export type CoreEventCreate = APIBody<'/api/core/event', 'post'>;
export type CoreEventUpdate = APIBody<'/api/core/event/{:event}', 'patch'>;

export type CoreDevice = APIResponse<'/api/core/device/{:device}', 'get'>;
export type CoreDeviceList = APIResponse<'/api/core/device', 'get'>;
export type CoreDeviceListQuery = APIQuery<'/api/core/device', 'get'>;
export type CoreDeviceCreate = APIBody<'/api/core/device', 'post'>;
export type CoreDeviceUpdate = APIBody<'/api/core/device/{:device}', 'patch'>;

export type CoreEventAssignment = APIResponse<'/api/core/event/{:event}/assignment/{:assignment}', 'get'>;
export type CoreEventAssignmentList = APIResponse<'/api/core/event/{:event}/assignment', 'get'>;
export type CoreEventAssignmentListQuery = APIQuery<'/api/core/event/{:event}/assignment', 'get'>;
export type CoreEventAssignmentCreate = APIBody<'/api/core/event/{:event}/assignment', 'post'>;
export type CoreEventAssignmentUpdate = APIBody<'/api/core/event/{:event}/assignment/{:assignment}', 'patch'>;
