import { Type } from '@sinclair/typebox';
import type { TSchema } from '@sinclair/typebox';

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
    status: Type.Optional(Type.String()),
    created: Type.String(),
    updated: Type.String(),
    template: Type.Boolean(),
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
        groups: Type.Array(Type.String()),
        config: Type.Object({
            timezone: Type.Optional(Type.Object({
                timezone: Type.String()
            }))
        }),
    }))
});
