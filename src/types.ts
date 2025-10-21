import { TSchema, Type } from '@sinclair/typebox';

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
        ephemeral: Type.Record(Type.String(), Type.Unknown()),
        environment: Type.Record(Type.String(), Type.Unknown()),
    })),

    incoming: Type.Optional(Type.Object({
        created: Type.String(),
        updated: Type.String(),
        enabled_styles: Type.Boolean(),
        styles: Type.Unknown(),
        data: Type.Union([Type.Number(), Type.Null()]),
        cron: Type.String(),
        ephemeral: Type.Record(Type.String(), Type.Unknown()),
        webhooks: Type.Boolean(),
        environment: Type.Record(Type.String(), Type.Unknown()),
        config: Type.Object({
            timezone: Type.Optional(Type.Object({
                timezone: Type.String()
            }))
        }),
    }))
});
