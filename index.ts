import fs from 'node:fs';
import type Lambda from 'aws-lambda';
import SecretsManager from '@aws-sdk/client-secrets-manager';
import express from 'express';
import type { Application}  from 'express';
import minimist from 'minimist';
import { Type, Static, TSchema, TUnknown, FormatRegistry, } from '@sinclair/typebox';
import Schema from '@openaddresses/batch-schema';
import moment from 'moment-timezone';
import { Feature } from '@tak-ps/node-cot'
import jwt from 'jsonwebtoken';
import { DataFlowType, SchemaType, TaskLayer, Capabilities, InvocationType } from './src/types.js';
import serverless from '@tak-ps/serverless-http';
import type { Event, TaskBaseSettings, TaskLayerAlert, } from './src/types.js';

export * as APITypes from './src/api-types.js';

import fetch from './src/fetch.js'
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

export const InputFeature = Feature.InputFeature;

export const InputFeatureCollection = Type.Object({
    type: Type.Literal('FeatureCollection'),
    features: Type.Array(Feature.InputFeature)
})

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

    const args = minimist(process.argv, {})

    if (!args._[2] || args._[2] === 'control') {
        await handler(task);
    } else if (['control:webhooks'].includes(args._[2])) {
        const app = await task.controlWebhooks()
        app.listen(5002, () => {
            console.log('ok - listening http://localhost:5002');
        })
    } else if (['capabilities'].includes(args._[2])) {
        const res = await handler(task, { type: 'capabilities' });
        console.log(JSON.stringify(res))
    } else {
        console.error('Unknown Command: ' + args._[2])
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
    static version: string = JSON.parse(String(fs.readFileSync('package.json'))).version;

    static flow: DataFlowType[] = [ DataFlowType.Incoming ];
    static invocation: InvocationType[] = [ InvocationType.Schedule ];

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
            // @ts-expect-error Typescript doesn't handle this yet
            version: this.constructor.version,
        };

        // @ts-expect-error Typescript doesn't handle this yet
        if (this.constructor.flow.includes(DataFlowType.Incoming)) {
            base.incoming = {
                // @ts-expect-error Typescript doesn't handle this yet
                invocation: this.constructor.invocation,
                schema: {
                    input: await this.schema(SchemaType.Input, DataFlowType.Incoming),
                    output: await this.schema(SchemaType.Output, DataFlowType.Incoming)
                }
            }
        }

        // @ts-expect-error Typescript doesn't handle this yet
        if (this.constructor.flow.includes(DataFlowType.Outgoing)) {
            base.outgoing = {
                schema: {
                    input: await this.schema(SchemaType.Input, DataFlowType.Outgoing),
                    output: await this.schema(SchemaType.Output, DataFlowType.Outgoing)
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
     * @returns A JSON Schema Object
     */
    async schema(
        type: SchemaType = SchemaType.Input,
        flow: DataFlowType = DataFlowType.Incoming
    ): Promise<TSchema> {
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
    async fetch(url: string | URL, opts?: RequestInit): Promise<object> {
        if (!opts) opts = {};
        if (!opts.method) opts.method = 'GET';
        console.log(`ok - ${opts.method}: ${url}`);

        if (!opts.headers) {
            opts.headers = new Headers();
        } else {
            if (!(opts.headers instanceof Headers) && Array.isArray(opts.headers)) {
                opts.headers = new Headers(opts.headers);
            } else if (!(opts.headers instanceof Headers) && typeof opts.headers === 'object') {
                const headers = new Headers();
                for (const header in opts.headers) {
                    headers.append(header, opts.headers[header]);
                }
                opts.headers = headers;
            }
        }

        if (!opts.headers.has('Authorization')) {
            opts.headers.append('Authorization', `Bearer ${this.etl.token}`);
        }

        if (typeof opts.body === 'object') {
            opts.body =  JSON.stringify(opts.body)
            opts.headers.append('Content-Type', 'application/json');
        }

        // @ts-expect-error Handle Undici vs Node TS complaints around FormData
        const res = await fetch(url instanceof URL ? url : new URL(url, this.etl.api), opts);

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
            body: JSON.stringify(alertin)
        });

        if (!alert.ok) {
            console.error(await alert.text());
            throw new Error('Failed to post alert to ETL');
        } else {
            return await alert.json() as object;
        }
    }

    /**
     * Validate and provide a validated Environment object
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

            return TypeValidator.type(type, this.layer.incoming.environment);
        } else {
            if (!this.layer.outgoing) {
                throw new Error('Cannot call env() without outgoing config');
            }

            return TypeValidator.type(type, this.layer.outgoing.environment);
        }
    }

    /**
     * Set ephemeral key/values
     * Overwrites existing values, if any
     *
     * @returns A Layer Config Object
     */
    async setEphemeral(
        ephem: Record<string, string>,
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
            body: JSON.stringify(ephem)
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
            }
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
     * Submit a GeoJSON Feature collection to be submitted to the TAK Server as CoTs
     *
     * @returns A boolean representing the success state
     */
    async submit(
        fc: Static<typeof InputFeatureCollection>,
        opts?: { verbose?: boolean }
    ): Promise<boolean> {
        if (!opts) opts = {};
        if (opts.verbose === undefined) opts.verbose = false;

        if (!this.layer) this.layer = await this.fetchLayer();

        if (!this.layer.incoming) throw new Error('Cannot call submit() without incoming config');

        let schema = await this.schema(SchemaType.Output, DataFlowType.Incoming);
        if (!schema || !schema.properties) schema = Type.Object({});

        const fields = Object.keys(schema.properties).filter((k) => {
            if (!schema.properties[k]) return false;
            return schema.properties[k].format === 'date-time';
        });

        // Postprocessing Functions have been defined
        if (Object.keys(this.layer.incoming.config).length) {
            const cnf = this.layer.incoming.config;
            if (cnf.timezone && cnf.timezone.timezone && cnf.timezone.timezone.toLowerCase() !== 'no timezone') {
                for (const feat of fc.features) {
                    for (const field of fields) {
                        if (!feat.properties.metadata || !feat.properties.metadata[field]) continue;
                        feat.properties.metadata[field] = moment(feat.properties.metadata[field]).tz(cnf.timezone.timezone).format('YYYY-MM-DD HH:mm') + ` (${cnf.timezone.timezone})`;
                    }
                }
            }
        }

        console.log(`ok - posting ${fc.features.length} features`);

        if (process.env.DEBUG) for (const feat of fc.features) console.error(JSON.stringify(feat));

        // Store feats as buffers
        const uids = JSON.stringify(fc.features.map((f) => { return f.id; }));
        const pre = Buffer.from(`{"type":"FeatureCollection", "uids": ${uids}, "features":[`);
        const post = Buffer.from(']}')
        let buffs = [pre];
        let submit = false;
        let curr = pre.byteLength + post.byteLength;

        do {
            let tmpbuff: null | Buffer = null;
            if (fc.features.length) {
                tmpbuff = Buffer.from((buffs.length > 1 ? ',' : '') + JSON.stringify(fc.features.pop()))

                if (curr + tmpbuff.byteLength <= this.etl.config.submit_size) {
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

                console.log(`ok - POST ${new URL(`/api/layer/${this.etl.layer}/cot`, this.etl.api)}`);

                buffs.push(post);
                const postreq = await fetch(new URL(`/api/layer/${this.etl.layer}/cot`, this.etl.api), {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.etl.token}`,
                        'Content-Type': 'application/json'
                    },
                    body: Buffer.concat(buffs)
                });

                if (!postreq.ok) {
                    if (opts.verbose) console.error(await postreq.text());
                    throw new Error('Failed to post layer to ETL');
                }

                if (tmpbuff) {
                    buffs = [pre, tmpbuff.slice(1)]; // Remove the preceding comma if staring the FC over
                    curr = pre.byteLength + post.byteLength + tmpbuff.byteLength;
                } else {
                    buffs = [pre];
                    curr = pre.byteLength + post.byteLength;
                }
            }
        } while (fc.features.length || buffs.length > 1);

        return true;
    }
}

export type {
    Event,
    TaskBaseSettings,
    TaskLayerAlert,
}

export {
    TaskLayer,
    SchemaType,
    Capabilities,
    InvocationType,
    DataFlowType,
    Feature,
    fetch,
};

