import { TSchema, Type } from '@sinclair/typebox';

export enum EventType {
    Capabilities = 'capabilities',
    SchemaInput = 'schema:input',
    SchemaOutput = 'schema:output',
}

export enum DataFlowType {
    Incoming = 'incoming',
    Outgoing = 'outgoing',
}

export interface Event {
    type?: string

    // API Gateway call
    version?: string
    routeKey?: string
}

export enum SchemaType {
    Input = 'Input',
    Output = 'Output'
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
    Schedule = 'schedule',
    Webhook = 'webhook'
}

export const Capabilities = Type.Object({
    name: Type.String(),
    version: Type.String(),
    incoming: Type.Optional(Type.Object({
        invocation: Type.Array(Type.Enum(InvocationType)),
        schema: Type.Object({
            input: Type.Unknown(),
            output: Type.Unknown()
        })
    })),
    outgoing: Type.Optional(Type.Object({
        schema: Type.Object({
            input: Type.Unknown(),
            output: Type.Unknown()
        })
    }))
});

export const BasicSchema = Type.Object({
    type: Type.Literal('object'),
    required: Type.Optional(Type.Array(Type.String())),
    properties: Type.Record(Type.String(), Type.Any())
});

export const TaskLayer = Type.Object({
    id: Type.Integer(),
    name: Type.String(),
    created: Type.String(),
    updated: Type.String(),
    description: Type.String(),
    enabled: Type.Boolean(),
    enabled_styles: Type.Boolean(),
    styles: Type.Unknown(),
    logging: Type.Boolean(),
    stale: Type.Integer(),
    task: Type.String(),
    cron: Type.String(),
    ephemeral: Type.Record(Type.String(), Type.String()),
    environment: Type.Record(Type.String(), Type.Unknown()),
    schema: BasicSchema,
    config: Type.Object({
        timezone: Type.Optional(Type.Object({
            timezone: Type.String()
        }))
    }),
    memory: Type.Number(),
    timeout: Type.Number(),

    data: Type.Union([Type.Number(), Type.Null()]),
    connection: Type.Number()
});
