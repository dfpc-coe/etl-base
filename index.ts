import fs from 'node:fs';
import type Lambda from 'aws-lambda';
import SecretsManager from '@aws-sdk/client-secrets-manager';
import { parseArgs } from 'node:util';
import express from 'express';
import type { Application}  from 'express';
import { Type, FormatRegistry } from '@sinclair/typebox';
import type { Static, TSchema, TUnknown } from '@sinclair/typebox';
import Schema from '@openaddresses/batch-schema';
import { Feature } from '@tak-ps/node-cot'
import jwt from 'jsonwebtoken';
import { fetch } from '@tak-ps/node-safeurl';
import type { FetchInit } from '@tak-ps/node-safeurl';
import { DataFlowType, SchemaType, TaskLayer, Capabilities, InvocationDefaults, InvocationType, OutgoingMessageType, OutgoingAction, OutgoingMessage, OutgoingFeatureMessage, OutgoingEventMessage, OutgoingDeviceMessage, OutgoingBoardMessage, OutgoingBoardColumnMessage, OutgoingBoardEventMessage, SubmitFeature, SubmitFeatureCollection } from './src/types.js';
import serverless from '@tak-ps/serverless-http';
import type { Event, TaskBaseSettings, TaskLayerAlert, NamedSchema, SubmitRecords } from './src/types.js';

export * as APITypes from './src/api-types.js';

export { default as StaticCapabilities, CAPABILITIES_ANNOTATION, StaticCapabilitiesSchema, PERMISSIONS, OUTGOING_TYPES } from './src/capabilities.js';
export type { StaticCapabilitiesDocument } from './src/capabilities.js';

import TypeValidator from './src/type.js'
import * as formats from './src/formats/index.js';

FormatRegistry.Set('date-time', formats.IsDateTime);
FormatRegistry.Set('date', formats.IsDate);
FormatRegistry.Set('time', formats.IsTime);
FormatRegistry.Set('email', formats.IsEmail);
FormatRegistry.Set('ipv4', formats.IsIPv4);
FormatRegistry.Set('ipv6', formats.IsIPv6);
FormatRegistry.Set('url', formats.IsUrl);
FormatRegistry.Set('uuid', formats.IsUuid);

export function env(current: string) {
    try {
        const dotfile = new URL('.env', current);

        fs.accessSync(dotfile);

        Object.assign(process.env, JSON.parse(String(fs.readFileSync(dotfile))));
    } catch (err) {
        console.log(`ok - no .env file loaded: ${err instanceof Error ? err.message : 'unknown reason'}`);
    }
}

export async function local(task: TaskBase, current: string) {
    if (current !== `file://${process.argv[1]}`) return;

    const { positionals } = parseArgs({ args: process.argv.slice(2), allowPositionals: true });
    const command = positionals[0];

    if (!command || command === 'control') {
        await handler(task);
    } else if (command === 'control:webhooks') {
        const app = await task.controlWebhooks()
        app.listen(5002, () => {
            console.log('ok - listening http://localhost:5002');
        })
    } else if (command === 'capabilities') {
        const res = await handler(task, { type: 'capabilities' });
        console.log(JSON.stringify(res))
    } else {
        console.error('Unknown Command: ' + command)
        process.exit()
    }
}

export async function handler(
    task: TaskBase,
    event: Event = {},
    context?: object
) {
    if (task.logging.event) {
        console.log('Event: ', JSON.stringify(event));
    }

    if (event.type == 'capabilities') {
        return await task.capabilities();
    } else if (String(event.type) == 'environment:incoming') {
        return await task.update(DataFlowType.Incoming);
    } else if (String(event.type) == 'environment:outgoing') {
        return await task.update(DataFlowType.Outgoing);
    } else if (Array.isArray(event.Records)) {
        // @ts-expect-error Typescript doesn't handle this yet
        if (!task.constructor.flow.includes(DataFlowType.Outgoing)) {
            throw new Error('Outgoing Data flow is not provided by this ETL Layer');
        }

        return task.outgoing(event as Lambda.SQSEvent)
    } else {
        // @ts-expect-error Typescript doesn't handle this yet
        if (!task.constructor.flow.includes(DataFlowType.Incoming)) {
            throw new Error('Incoming Data flow is not provided by this ETL Layer');
        }

        if (event.version && event.routeKey) {
            // @ts-expect-error Typescript doesn't handle this yet
            if (task.constructor.invocation.includes(InvocationType.Webhook)) {
                if (!context) throw new Error('Context must be provided for webhook functionality');
                return serverless(await task.controlWebhooks())(event, context);
            } else {
                throw new Error('Webhook Invocation type is not configured');
            }
        } else {
            // @ts-expect-error Typescript doesn't handle this yet
            if (task.constructor.invocation.includes(InvocationType.Schedule)) {
                await task.control();
            } else {
                throw new Error('Schedule Invocation type is not configured');
            }
        }
    }
}

export type TaskLogging = {
    event: boolean
    webhooks: boolean
}

export default class TaskBase {
    static name: string = 'default';

    static flow: DataFlowType[] = [ DataFlowType.Incoming ];
    static invocation: InvocationType[] = [ InvocationType.Schedule ];
    static invocationDefaults: Static<typeof InvocationDefaults> = {};

    static webhooks?: (schema: Schema, context: TaskBase) => Promise<void>;

    etl: TaskBaseSettings;
    layer?: Static<typeof TaskLayer>;

    logging: TaskLogging

    /**
     * Create a new TaskBase instance - Usually not called directly but instead
     * inherited via an `extends TaskBase` call
     *
     * Currently settings are configured based on the environment that will be provided by the
     * ETL server. As such the following environment variables must be set.
     * `ETL_API` - The URL of the API to use
     * `ETL_LAYER` - The Integer Layer ID to get config information and post results to
     * `ETL_TOKEN` - The access token specific to the Layer
     */
    constructor(
        current?: string,
        opts?: {
            logging?: {
                event?: boolean
                webhooks?: boolean
            }
        }
    ) {
        if (!opts) opts = {};
        if (!opts.logging) opts.logging = {};

        this.logging = {
            event: opts.logging.event === undefined ? false : opts.logging.event,
            webhooks: opts.logging.webhooks === undefined ? true : opts.logging.webhooks
        }

        this.etl = {
            api: process.env.ETL_API || '',
            layer: process.env.ETL_LAYER || '',
            token: process.env.ETL_TOKEN || '',
            config: {
                submit_size: 49 * 1000000
            }
        };

        if (!this.etl.api) throw new Error('No ETL API URL Provided');
        if (!this.etl.layer) throw new Error('No ETL Layer Provided');
        if (!this.etl.token) throw new Error('No ETL Token Provided');
    }

    static async init(
        current?: string,
        opts?: {
            logging?: {
                event?: boolean
                webhooks?: boolean
            }
        }
    ): Promise<TaskBase> {
        if (current) {
            env(current);
        }

        // This is just a helper function for local development, signing with the (unsecure) default secret
        if (!process.env.ETL_TOKEN && process.env.ETL_API && (new URL(process.env.ETL_API)).hostname === 'localhost') {
            if (!process.env.ETL_LAYER) throw new Error('No ETL_LAYER env var set');

            if (process.env.StackName) {
                const secrets = new SecretsManager.SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' });

                const secret = await secrets.send(new SecretsManager.GetSecretValueCommand({
                    SecretId: `${process.env.StackName}/api/secret`
                }));

                if (!secret.SecretString) throw new Error('No Secret Set');

                process.env.ETL_TOKEN = `etl.${jwt.sign({
                    access: 'layer',
                    id: parseInt(process.env.ETL_LAYER),
                    internal: true
                }, secret.SecretString)}`
            } else {
                process.env.ETL_TOKEN = `etl.${jwt.sign({
                    access: 'layer',
                    id: parseInt(process.env.ETL_LAYER),
                    internal: true
                }, 'coe-wildland-fire')}`
            }
        }

        return new this(current, opts);
    }

    async outgoing(event: Lambda.SQSEvent): Promise<boolean> {
        console.error(event);
        return true;
    }

    /**
     * Parse the SQS records of an Outgoing invocation into typed messages.
     * Records predating the `type` field are treated as `feature` messages
     */
    static outgoingMessages(event: Lambda.SQSEvent): Array<Static<typeof OutgoingMessage>> {
        return event.Records.map((record) => {
            const body = JSON.parse(record.body) as Record<string, unknown>;
            if (body.type === undefined) body.type = OutgoingMessageType.Feature;

            return TypeValidator.type(OutgoingMessage, body, { convert: false });
        });
    }

    async control(): Promise<void> {
        return;
    }

    /**
     * Called by CloudTAK when a significant Config Change takes place
     */
    async update(flow: DataFlowType): Promise<void> {
        console.log('update:', flow);
        return;
    }

    async capabilities(): Promise<Static<typeof Capabilities>> {
        const base: Static<typeof Capabilities> = {
            name: this.constructor.name,
            version: JSON.parse(String(fs.readFileSync('package.json'))).version
        };

        // @ts-expect-error Typescript doesn't handle this yet
        if (this.constructor.flow.includes(DataFlowType.Incoming)) {
            base.incoming = {
                // @ts-expect-error Typescript doesn't handle this yet
                invocation: this.constructor.invocation,
                // @ts-expect-error Typescript doesn't handle this yet
                invocationDefaults: this.constructor.invocationDefaults,
                schema: {
                    input: null,
                    output: null
                }
            }

            try {
                base.incoming.schema.input = await this.schema(SchemaType.Input, DataFlowType.Incoming);
            } catch (err) {
                base.incoming.schema.inputError = {
                    status: 400,
                    message: err instanceof Error ? err.message : String(err)
                }
            }

            try {
                base.incoming.schema.output = await this.schema(SchemaType.Output, DataFlowType.Incoming);
            } catch (err) {
                base.incoming.schema.outputError = {
                    status: 400,
                    message: err instanceof Error ? err.message : String(err)
                }
            }
        }

        // @ts-expect-error Typescript doesn't handle this yet
        if (this.constructor.flow.includes(DataFlowType.Outgoing)) {
            base.outgoing = {
                schema: {
                    input: null,
                    output: null
                }
            }

            try {
                base.outgoing.schema.input = await this.schema(SchemaType.Input, DataFlowType.Outgoing);
            } catch (err) {
                base.outgoing.schema.inputError = {
                    status: 400,
                    message: err instanceof Error ? err.message : String(err)
                }
            }

            try {
                base.outgoing.schema.output = await this.schema(SchemaType.Output, DataFlowType.Outgoing);
            } catch (err) {
                base.outgoing.schema.outputError = {
                    status: 400,
                    message: err instanceof Error ? err.message : String(err)
                }
            }
        }

        return base;
    }


    /**
     * The extended class should override this function if it needs additional user-defined
     * config values or wants to provide a Schema
     *
     * Input: By default it simply adds a `DEBUG` boolean which will conditionally print
     * CoT GeoJSON in the logs if true.
     *
     * Output: Does not provide a defined schema. Providing a schema allow the User to perform
     * mapping and styling operations
     *
     * Tasks that submit multiple Feature shapes can instead return an array of
     * named Output schemas - one `{ id, schema }` entry per shape, with the id
     * referenced by the `schema` field of the submitted FeatureCollection
     *
     * @returns A JSON Schema Object or an array of named JSON Schema Objects
     */
    async schema(
        type: SchemaType = SchemaType.Input,
        flow: DataFlowType = DataFlowType.Incoming
    ): Promise<TSchema | Array<NamedSchema>> {
        if (flow === DataFlowType.Incoming) {
            if (type === SchemaType.Input) {
                return Type.Object({
                    'DEBUG': Type.Boolean({
                        default: false,
                        description: 'Print results in logs'
                    })
                });
            } else {
                return Type.Object({});
            }
        } else {
            return Type.Object({});
        }
    }

    /**
     * Arbitrary JSON objects occasionally need to get typed as part of an ETL
     * This function provides the ability to strictly type unknown objects at runtime
     */
    type<T extends TSchema = TUnknown>(type: T, body: unknown): Static<T> {
        return TypeValidator.type(type, body);
    }

    async controlWebhooks(): Promise<Application> {
        const app = express();

        const schema = new Schema(express.Router(), {
            logging: this.logging.webhooks,
            limit: 50
        });

        app.use(schema.router);

        // @ts-expect-error Typescript doesn't handle this yet
        if (this.constructor.webhooks) {
            // @ts-expect-error Typescript doesn't handle this yet
            await this.constructor.webhooks(schema, this);
        }

        return app;
    }

    /**
     * Provides a Fetch class with preset Authentication and JSON parsing
     * For making calls to CloudTAK APIs
     *
     * @returns The parsed response body
     */
    async fetch(url: string | URL, opts?: FetchInit): Promise<object> {
        if (!opts) opts = {};
        if (!opts.method) opts.method = 'GET';
        console.log(`ok - ${opts.method}: ${url}`);

        const headers: Record<string, string> = {};

        if (opts.headers) {
            if (Array.isArray(opts.headers)) {
                for (const [key, value] of opts.headers) {
                    headers[key] = value;
                }
            } else if (typeof opts.headers === 'object') {
                const h = opts.headers as Record<string, string>;
                for (const key in h) {
                    headers[key] = h[key];
                }
            }
        }

        if (!headers['Authorization']) {
            headers['Authorization'] = `Bearer ${this.etl.token}`;
        }

        if (typeof opts.body === 'object') {
            opts.body =  JSON.stringify(opts.body)
            headers['Content-Type'] = 'application/json';
        }

        opts.headers = headers;

        const res = await fetch(url instanceof URL ? url : new URL(url, this.etl.api), { ...opts, safeUrlAllow: [this.etl.api] });

        if (!res.ok) {
            const body = await res.text();
            console.error(body);

            const json = JSON.parse(body)
            throw new Error(json.message);
        } else {
            return await res.json() as object;
        }
    }

    /**
     * Post an Alert to the Layer Alert API
     *
     * @returns The Response from the Layer Alert API
     */
    async alert(alertin: TaskLayerAlert): Promise<object> {
        if (!this.layer) {
            this.layer = await this.fetchLayer();
        }

        console.log(`ok - Generating Alert`);
        const alert = await fetch(new URL(`/api/connection/${this.layer.connection}/layer/${this.layer.id}/alert`, this.etl.api), {
            method: 'post',
            headers: {
                'Authorization': `Bearer ${this.etl.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(alertin),
            safeUrlAllow: [this.etl.api]
        });

        if (!alert.ok) {
            console.error(await alert.text());
            throw new Error('Failed to post alert to ETL');
        } else {
            return await alert.json() as object;
        }
    }

    /**
     * Validate and return a typed Environment object
     */
    async env<T extends TSchema = TUnknown>(
        type: T,
        flow: DataFlowType = DataFlowType.Incoming
    ): Promise<Static<T>> {
        if (!this.layer) this.layer = await this.fetchLayer();

        if (flow === DataFlowType.Incoming) {
            if (!this.layer.incoming) {
                throw new Error('Cannot call env() without incoming config');
            }

            return TypeValidator.type(type, this.layer.incoming.environment, {
                verbose: true
            });
        } else {
            if (!this.layer.outgoing) {
                throw new Error('Cannot call env() without outgoing config');
            }

            return TypeValidator.type(type, this.layer.outgoing.environment);
        }
    }

    /**
     * Validate and return a typed Ephemeral object
     * If the object fails validation, the store will be reset and an empty store returned
     */
    async ephemeral<T extends TSchema = TUnknown>(
        type: T,
        flow: DataFlowType = DataFlowType.Incoming
    ): Promise<Static<T>> {
        if (!this.layer) this.layer = await this.fetchLayer();

        if (flow === DataFlowType.Incoming) {
            if (!this.layer.incoming) {
                throw new Error('Cannot call ephemeral() without incoming config');
            }

            try {
                return TypeValidator.type(type, this.layer.incoming.ephemeral);
            } catch (err) {
                console.error(err);
                await this.setEphemeral({}, DataFlowType.Incoming);
                return {};
            }
        } else {
            if (!this.layer.outgoing) {
                throw new Error('Cannot call ephemeral() without outgoing config');
            }

            try {
                return TypeValidator.type(type, this.layer.outgoing.ephemeral);
            } catch (err) {
                console.error(err);
                await this.setEphemeral({}, DataFlowType.Outgoing);
                return {};
            }
        }
    }

    /**
     * Set ephemeral key/values
     * Overwrites existing values, if any
     *
     * @returns A Layer Config Object
     */
    async setEphemeral(
        ephem: Record<string, unknown>,
        flow: DataFlowType = DataFlowType.Incoming
    ): Promise<void> {
        if (!this.layer) this.layer = await this.fetchLayer();

        const url = new URL(`/api/connection/${this.layer.connection}/layer/${this.layer.id}/${flow}/ephemeral`, this.etl.api);
        console.log(`ok - PUT ${url}`);
        const res_layer = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${this.etl.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(ephem),
            safeUrlAllow: [this.etl.api]
        });

        if (!res_layer.ok) {
            console.error(await res_layer.text());
            throw new Error('Failed to put ephemeral values to ETL');
        }
    }

    /**
     * Get all information about the layer being processed
     * most importantly the user-defined `environment` object
     *
     * @returns A Layer Config Object
     */
    async fetchLayer(): Promise<Static<typeof TaskLayer>> {
        if (this.layer) return this.layer;

        console.log(`ok - GET ${new URL(`/api/layer/${this.etl.layer}`, this.etl.api)}`);
        const res_layer = await fetch(new URL(`/api/layer/${this.etl.layer}`, this.etl.api), {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${this.etl.token}`,
            },
            safeUrlAllow: [this.etl.api]
        });

        if (!res_layer.ok) {
            console.error(await res_layer.text());
            throw new Error('Failed to get layer from ETL');
        } else {
            this.layer = await res_layer.typed(TaskLayer);

            // Ensure you don't accidently run an ETL against a layer not of the same type - mostly for local dev
            if (!this.layer.task.startsWith(this.constructor.name)) {
                throw new Error(`Remote layer is not of type: ${this.constructor.name}`);
            }

            return this.layer;
        }
    }

    /**
     * Submit a GeoJSON Feature Collection to CloudTAK
     *
     * A FeatureCollection carrying a `schema` is posted to the
     * /connection/:connection/submit API where its Features are mapped to CoT
     * Features, Core Events or Core Devices by the Layer's Maps for that named
     * Output schema - the geometry of those Features may be omitted or null
     *
     * A FeatureCollection without a `schema` is posted to the legacy
     * /layer/:layer/cot API and every Feature is delivered as CoT
     *
     * A deprecated `{ schema, items }` record submission is still posted to
     * the /layer/:layer/submit API via submitRecords()
     *
     * Submissions over `submit_size` are split into multiple posts, each
     * carrying the same `schema` and the ids of every Feature in the submission
     *
     * @returns A boolean representing the success state
     */
    async submit(
        input: Static<typeof Feature.InputFeatureCollection> | Static<typeof SubmitFeatureCollection> | SubmitRecords,
        opts?: {
            verbose?: boolean,
            archive?: boolean
        }
    ): Promise<boolean> {
        if (!opts) opts = {};
        if (opts.verbose === undefined) opts.verbose = false;
        if (opts.archive === undefined) opts.archive = true;

        if (!this.layer) this.layer = await this.fetchLayer();

        if (!this.layer.incoming) throw new Error('Cannot call submit() without incoming config');

        if (!input || Array.isArray(input)) {
            throw new Error('Submissions must be provided as a GeoJSON FeatureCollection');
        }

        if ('items' in input) {
            if (typeof input.schema !== 'string' || input.schema.length === 0) {
                throw new Error('Record submissions must provide a non-empty schema string');
            } else if (!Array.isArray(input.items)) {
                throw new Error('Record submissions must provide an items array');
            }

            return await this.submitRecords(input, opts);
        }

        if (!Array.isArray(input.features)) {
            throw new Error('Submissions must be provided as a GeoJSON FeatureCollection');
        }

        await this.localizeTimestamps(input.features);

        if ('schema' in input && input.schema !== undefined) {
            if (typeof input.schema !== 'string' || input.schema.length === 0) {
                throw new Error('Schema submissions must provide a non-empty schema string');
            }

            return await this.submitSchema(input, opts);
        }

        console.log(`ok - posting ${input.features.length} features`);

        if (process.env.DEBUG) for (const feat of input.features) console.error(JSON.stringify(feat));

        const url = new URL(`/api/layer/${this.etl.layer}/cot`, this.etl.api);
        url.searchParams.append('archive', String(opts.archive));

        await this.postBatched({
            url,
            pre: Buffer.from(`{"type":"FeatureCollection", "uids": ${JSON.stringify(this.featureIds(input.features))}, "features":[`),
            post: Buffer.from(']}'),
            items: input.features,
            error: 'Failed to post layer to ETL',
            verbose: opts.verbose
        });

        return true;
    }

    /**
     * Post a `schema` FeatureCollection to the /connection/:connection/submit
     * API of the Connection the Layer belongs to - usually called via submit()
     *
     * @returns A boolean representing the success state
     */
    protected async submitSchema(
        input: Static<typeof SubmitFeatureCollection>,
        opts?: {
            verbose?: boolean,
            archive?: boolean
        }
    ): Promise<boolean> {
        if (!opts) opts = {};
        if (opts.verbose === undefined) opts.verbose = false;
        if (opts.archive === undefined) opts.archive = true;

        if (!this.layer) this.layer = await this.fetchLayer();

        if (this.layer.connection === null || this.layer.connection === undefined) {
            throw new Error('Cannot submit a schema FeatureCollection - Layer is not attached to a Connection');
        }

        console.log(`ok - posting ${input.features.length} ${input.schema} features`);

        if (process.env.DEBUG) for (const feat of input.features) console.error(JSON.stringify(feat));

        const url = new URL(`/api/connection/${this.layer.connection}/submit`, this.etl.api);
        url.searchParams.append('archive', String(opts.archive));

        await this.postBatched({
            url,
            pre: Buffer.from(`{"type":"FeatureCollection","schema":${JSON.stringify(input.schema)},"uids":${JSON.stringify(this.featureIds(input.features))},"features":[`),
            post: Buffer.from(']}'),
            items: input.features,
            error: 'Failed to post features to ETL',
            verbose: opts.verbose
        });

        return true;
    }

    /**
     * @deprecated Submit a FeatureCollection carrying a `schema` instead -
     * CloudTAK never implemented the /layer/:layer/submit API this posts to
     *
     * @returns A boolean representing the success state
     */
    protected async submitRecords(
        input: SubmitRecords,
        opts?: {
            verbose?: boolean
        }
    ): Promise<boolean> {
        if (!opts) opts = {};
        if (opts.verbose === undefined) opts.verbose = false;

        console.log(`ok - posting ${input.items.length} ${input.schema} records`);

        if (process.env.DEBUG) for (const record of input.items) console.error(JSON.stringify(record));

        await this.postBatched({
            url: new URL(`/api/layer/${this.etl.layer}/submit`, this.etl.api),
            pre: Buffer.from(`{"schema":${JSON.stringify(input.schema)},"items":[`),
            post: Buffer.from(']}'),
            items: input.items,
            error: 'Failed to post records to ETL',
            verbose: opts.verbose
        });

        return true;
    }

    private featureIds(features: Array<Static<typeof SubmitFeature>>): Array<string> {
        return features.map((f) => f.id).filter((id): id is string => typeof id === 'string');
    }

    /**
     * Rewrite `date-time` metadata fields into the timezone configured on the
     * Layer's incoming config, if any
     */
    private async localizeTimestamps(features: Array<Static<typeof SubmitFeature>>): Promise<void> {
        if (!this.layer || !this.layer.incoming) return;

        const cnf = this.layer.incoming.config;
        if (!cnf || !cnf.timezone || !cnf.timezone.timezone || cnf.timezone.timezone.toLowerCase() === 'no timezone') return;

        let schema = await this.schema(SchemaType.Output, DataFlowType.Incoming);
        if (!schema || Array.isArray(schema) || !schema.properties) schema = Type.Object({});

        const fields = Object.keys(schema.properties).filter((k) => {
            if (!schema.properties[k]) return false;
            return schema.properties[k].format === 'date-time';
        });

        for (const feat of features) {
            for (const field of fields) {
                if (!feat.properties.metadata || !feat.properties.metadata[field]) continue;
                const d = new Date(String(feat.properties.metadata[field]));
                const parts = new Intl.DateTimeFormat('en-CA', {
                    timeZone: cnf.timezone.timezone,
                    year: 'numeric', month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit', hour12: false
                }).formatToParts(d);
                const p = Object.fromEntries(parts.map(p => [p.type, p.value]));
                feat.properties.metadata[field] = `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} (${cnf.timezone.timezone})`;
            }
        }
    }

    /**
     * Stream `items` into one or more posts, each wrapped by `pre` and `post`
     * and kept under `submit_size` - an item that alone exceeds `submit_size`
     * is posted by itself so a batch is never empty
     */
    private async postBatched(opts: {
        url: URL;
        pre: Buffer;
        post: Buffer;
        items: Array<unknown>;
        error: string;
        verbose: boolean;
    }): Promise<void> {
        const items = opts.items.slice();

        let buffs: Array<Buffer<ArrayBufferLike>> = [opts.pre];
        let submit = false;
        let curr = opts.pre.byteLength + opts.post.byteLength;

        do {
            let tmpbuff: null | Buffer = null;
            if (items.length) {
                tmpbuff = Buffer.from((buffs.length > 1 ? ',' : '') + JSON.stringify(items.pop()))

                if (curr + tmpbuff.byteLength <= this.etl.config.submit_size || buffs.length === 1) {
                    curr = curr + tmpbuff.byteLength;
                    buffs.push(tmpbuff);
                    tmpbuff = null;
                } else {
                    submit = true;
                }
            } else {
                submit = true;
            }

            if (submit) {
                submit = false;

                console.log(`ok - POST ${opts.url}`);

                buffs.push(opts.post);

                const postreq = await fetch(opts.url, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.etl.token}`,
                        'Content-Type': 'application/json'
                    },
                    body: Buffer.concat(buffs),
                    safeUrlAllow: [this.etl.api]
                });

                if (!postreq.ok) {
                    if (opts.verbose) console.error(await postreq.text());
                    throw new Error(opts.error);
                }

                if (tmpbuff) {
                    buffs = [opts.pre, tmpbuff.slice(1)]; // Remove the preceding comma if starting the array over
                    curr = opts.pre.byteLength + opts.post.byteLength + tmpbuff.byteLength;
                } else {
                    buffs = [opts.pre];
                    curr = opts.pre.byteLength + opts.post.byteLength;
                }
            }
        } while (items.length || buffs.length > 1);
    }
}

export type {
    Event,
    TaskBaseSettings,
    TaskLayerAlert,
    NamedSchema,
    SubmitRecords,
}

export {
    TaskLayer,
    SchemaType,
    Capabilities,
    InvocationType,
    DataFlowType,
    OutgoingMessageType,
    OutgoingAction,
    OutgoingMessage,
    OutgoingFeatureMessage,
    OutgoingEventMessage,
    OutgoingDeviceMessage,
    OutgoingBoardMessage,
    OutgoingBoardColumnMessage,
    OutgoingBoardEventMessage,
    SubmitFeature,
    SubmitFeatureCollection,
    Feature,
    fetch,
};

