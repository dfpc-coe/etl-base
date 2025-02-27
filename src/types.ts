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

    // SQS Record
    Records?: unknown[]
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
    Manual = 'manual',
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

export const TaskLayer = Type.Object({
    id: Type.Integer(),
    name: Type.String(),
    created: Type.String(),
    updated: Type.String(),
    description: Type.String(),
    enabled: Type.Boolean(),
    logging: Type.Boolean(),
    task: Type.String(),
    memory: Type.Number(),
    timeout: Type.Number(),
    connection: Type.Number(),

    outgoing: Type.Optional(Type.Object({
        created: Type.String(),
        updated: Type.String(),
        ephemeral: Type.Record(Type.String(), Type.String()),
        environment: Type.Record(Type.String(), Type.Unknown()),
    })),

    incoming: Type.Optional(Type.Object({
        created: Type.String(),
        updated: Type.String(),
        enabled_styles: Type.Boolean(),
        styles: Type.Unknown(),
        stale: Type.Integer(),
        data: Type.Union([Type.Number(), Type.Null()]),
        cron: Type.String(),
        ephemeral: Type.Record(Type.String(), Type.String()),
        webhooks: Type.Boolean(),
        environment: Type.Record(Type.String(), Type.Unknown()),
        config: Type.Object({
            timezone: Type.Optional(Type.Object({
                timezone: Type.String()
            }))
        }),
    }))
});
