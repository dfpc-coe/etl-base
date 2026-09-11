import { Type } from '@sinclair/typebox';
import type { TSchema } from '@sinclair/typebox';
import { Feature } from '@tak-ps/node-cot';

export enum EventType {
}

export enum DataFlowType {
    Incoming = 'incoming',
    Outgoing = 'outgoing',
}

export interface Event {
    type?: 'capabilities' | 'environment:input' | 'environment:output' | 'schema:input' | 'schema:output'

    // API Gateway call
    version?: string
    routeKey?: string

    // SQS Record
    Records?: unknown[]
}

export enum SchemaType {
    Input = 'Input',
    Output = 'Output'
}

/**
 * A single named Output schema - tasks that submit multiple record shapes
 * return one entry per shape from schema(), with the id referenced by the
 * `schema` field of record submissions
 */
export interface NamedSchema {
    id: string;
    schema: TSchema;
}

/**
 * An arbitrary record submission posted to the /layer/:layer/submit API where
 * the items are mapped to CoT Features, Core Events or Core Devices by the
 * Layer's configured Maps
 */
export interface SubmitRecords {
    schema: string;
    items: Array<Record<string, unknown>>;
}

export interface TaskBaseSettings {
    api: string;
    layer: string;
    token: string;
    config: {
        submit_size: number;
    }
}

export interface TaskLayerAlert {
    icon?: string;
    priority?: string;
    title: string;
    description?: string;
}

export enum InvocationType {
    Manual = 'manual',
    Schedule = 'schedule',
    Webhook = 'webhook'
}

export const CapabilitiesError = Type.Object({
    status: Type.Number(),
    message: Type.String(),
});

export const InvocationDefaults = Type.Object({
    webhook: Type.Optional(Type.Object({
        enabled: Type.Boolean(),
    })),
    schedule: Type.Optional(Type.Object({
        enabled: Type.Boolean(),
        cron: Type.String(),
    }))
});

/**
 * The live Capabilities document returned by invoking a deployed task Lambda
 * with a `capabilities` event. It reflects the runtime environment of the
 * running image - the invocation modes and the input/output environment
 * schemas the task currently exposes for each data flow
 *
 * Note this format intentionally differs from the static Capabilities document
 * (the StaticCapabilities export of this package) which is authored alongside
 * the task's source code as a capabilities.json and embedded in the OCI Image
 * Manifest at build time, describing the task before it is ever deployed
 */
export const Capabilities = Type.Object({
    name: Type.String(),
    version: Type.String(),
    incoming: Type.Optional(Type.Object({
        invocation: Type.Array(Type.Enum(InvocationType)),
        invocationDefaults: InvocationDefaults,
        schema: Type.Object({
            input: Type.Unknown(),
            inputError: Type.Optional(CapabilitiesError),
            output: Type.Unknown(),
            outputError: Type.Optional(CapabilitiesError),
        })
    })),
    outgoing: Type.Optional(Type.Object({
        schema: Type.Object({
            input: Type.Unknown(),
            inputError: Type.Optional(CapabilitiesError),
            output: Type.Unknown(),
            outputError: Type.Optional(CapabilitiesError),
        })
    }))
});

export const TaskLayer = Type.Object({
    id: Type.Integer(),
    status: Type.Optional(Type.String()),
    created: Type.String(),
    updated: Type.String(),
    connection: Type.Union([Type.Null(), Type.Integer()]),
    username: Type.Union([Type.Null(), Type.String()]),
    uuid: Type.String(),
    name: Type.String(),
    description: Type.String(),
    enabled: Type.Boolean(),
    logging: Type.Boolean(),
    task: Type.String(),
    memory: Type.Integer(),
    timeout: Type.Integer(),
    priority: Type.Union([
        Type.Literal('high'),
        Type.Literal('low'),
        Type.Literal('off')
    ]),

    alarm_period: Type.Integer(),
    alarm_evals: Type.Integer(),
    alarm_points: Type.Integer(),

    parent: Type.Optional(Type.Object({
        id: Type.Integer(),
        name: Type.String(),
        enabled: Type.Boolean()
    })),

    outgoing: Type.Optional(Type.Object({
        layer: Type.Integer(),
        created: Type.String(),
        updated: Type.String(),
        ephemeral: Type.Record(Type.String(), Type.Unknown()),
        environment: Type.Any(),
        subscriptions: Type.Array(Type.String(), {
            description: 'Outgoing resource types the Layer is subscribed to - ie feature:* or event:update'
        }),
        filters: Type.Object({
            queries: Type.Optional(Type.Array(Type.Object({
                name: Type.Optional(Type.String()),
                query: Type.String()
            })))
        }),
    })),

    incoming: Type.Optional(Type.Object({
        layer: Type.Integer(),
        created: Type.String(),
        updated: Type.String(),
        enabled_styles: Type.Boolean(),
        styles: Type.Unknown(),
        data: Type.Union([Type.Integer(), Type.Null()]),
        cron: Type.Union([Type.String(), Type.Null()]),
        ephemeral: Type.Record(Type.String(), Type.Unknown()),
        webhooks: Type.Boolean(),
        environment: Type.Any(),
        config: Type.Object({
            timezone: Type.Optional(Type.Object({
                timezone: Type.String()
            }))
        }),
    }))
});

export enum OutgoingMessageType {
    Feature = 'feature',
    Event = 'event',
    Device = 'device',
    Board = 'board',
    BoardColumn = 'board:column',
    BoardEvent = 'board:event'
}

export enum OutgoingAction {
    Create = 'create',
    Update = 'update',
    Delete = 'delete'
}

/** A streaming CoT Feature delivered to an Outgoing Layer subscribed to `feature:*` */
export const OutgoingFeatureMessage = Type.Object({
    type: Type.Literal(OutgoingMessageType.Feature),
    xml: Type.String(),
    geojson: Feature.Feature
});

/** A CoreEvent lifecycle change delivered to an Outgoing Layer subscribed to `event:<action>` */
export const OutgoingEventMessage = Type.Object({
    type: Type.Literal(OutgoingMessageType.Event),
    action: Type.Enum(OutgoingAction),
    channels: Type.Array(Type.Integer(), {
        description: 'Channels shared by the Event and the Layer Connection that caused delivery'
    }),
    data: Type.Record(Type.String(), Type.Unknown())
});

/** A CoreDevice lifecycle change delivered to an Outgoing Layer subscribed to `device:<action>` */
export const OutgoingDeviceMessage = Type.Object({
    type: Type.Literal(OutgoingMessageType.Device),
    action: Type.Enum(OutgoingAction),
    channels: Type.Array(Type.Integer(), {
        description: 'Channels shared by the Device and the Layer Connection that caused delivery'
    }),
    data: Type.Record(Type.String(), Type.Unknown())
});

/** A CoreEvent Board lifecycle change delivered to an Outgoing Layer subscribed to `board:<action>` */
export const OutgoingBoardMessage = Type.Object({
    type: Type.Literal(OutgoingMessageType.Board),
    action: Type.Enum(OutgoingAction),
    channels: Type.Array(Type.Integer(), {
        description: 'Channels shared by the Board and the Layer Connection that caused delivery'
    }),
    data: Type.Record(Type.String(), Type.Unknown())
});

/** A Board Column lifecycle change delivered to an Outgoing Layer subscribed to `board:column:<action>` */
export const OutgoingBoardColumnMessage = Type.Object({
    type: Type.Literal(OutgoingMessageType.BoardColumn),
    action: Type.Enum(OutgoingAction),
    channels: Type.Array(Type.Integer(), {
        description: 'Channels shared by the Board the Column belongs to and the Layer Connection that caused delivery'
    }),
    data: Type.Record(Type.String(), Type.Unknown())
});

/** A CoreEvent placement on a Board being created, moved or removed, delivered to an Outgoing Layer subscribed to `board:event:<action>` */
export const OutgoingBoardEventMessage = Type.Object({
    type: Type.Literal(OutgoingMessageType.BoardEvent),
    action: Type.Enum(OutgoingAction),
    channels: Type.Array(Type.Integer(), {
        description: 'Channels shared by the Board the Event is placed on and the Layer Connection that caused delivery'
    }),
    data: Type.Record(Type.String(), Type.Unknown())
});

export const OutgoingMessage = Type.Union([
    OutgoingFeatureMessage,
    OutgoingEventMessage,
    OutgoingDeviceMessage,
    OutgoingBoardMessage,
    OutgoingBoardColumnMessage,
    OutgoingBoardEventMessage
]);
