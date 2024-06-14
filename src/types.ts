import { TSchema, Type } from '@sinclair/typebox';

export enum EventType {
    SchemaInput = 'schema:input',
    SchemaOutput = 'schema:output',
}

export interface Event {
    type?: string
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

export interface TaskLayer {
    id: number;
    name: string;
    created: number;
    updated: number;
    description: string;
    enabled: boolean;
    enabled_styles: boolean;
    styles: unknown;
    logging: boolean;
    stale: number;
    task: string;
    cron: string;
    environment: {
        [k: string]: unknown
    };
    schema: TSchema;
    config: {
        timezone?: {
            timezone: string;
        }
    };
    memory: number;
    timeout: number;

    data: number | null;
    connection: number | null;
}
