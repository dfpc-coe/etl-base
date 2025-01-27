import fs from 'node:fs';
import express from 'express';
import minimist from 'minimist';
import { Type, Static, TSchema, TUnknown, FormatRegistry, } from '@sinclair/typebox';
import Schema from '@openaddresses/batch-schema';
import { Value } from '@sinclair/typebox/value'
import { TypeCompiler } from "@sinclair/typebox/compiler";
import moment from 'moment-timezone';
import { Feature } from '@tak-ps/node-cot'
import jwt from 'jsonwebtoken';
import { EventType, SchemaType, TaskLayer, Capabilities, InvocationType } from './src/types.js';
import serverless from 'serverless-http';
import type { Event, TaskBaseSettings, TaskLayerAlert, } from './src/types.js';

import fetch from './src/fetch.js'
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
    } else if (['capabilities', 'schema:input', 'schema:output'].includes(args._[2])) {
        const res = await handler(task, { type: args._[2] });
        console.log(JSON.stringify(res))
    } else {
        console.error('Unknown Command: ' + args._[2])
        process.exit()
    }
}

export async function handler(task: TaskBase, event: Event = {}) {
    if (event.type === EventType.Capabilities) {
        return await task.capabilities();
    } else if (event.type === EventType.SchemaInput) {
        return await task.schema(SchemaType.Input);
    } else if (event.type === EventType.SchemaOutput) {
        return await task.schema(SchemaType.Output);
    } else {
        if (event.version && event.routeKey) {
            return serverless(this.webhooks())
        } else {
            await task.control();
        }
    }
}

export default class TaskBase {
    static name: string = 'default';
    static version: string = JSON.parse(String(fs.readFileSync('package.json'))).version;
    static invocation: InvocationType[] = [ InvocationType.Schedule ];
    static webhooks: (schema: Schema) => void;

    etl: TaskBaseSettings;
    layer?: Static<typeof TaskLayer>;

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
    constructor(current?: string) {
        if (current) {
            env(current);
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

        // This is just a helper function for local development, signing with the (unsecure) default secret
        if (!this.etl.token && (new URL(this.etl.api)).hostname === 'localhost') {
            this.etl.token = `etl.${jwt.sign({ access: 'layer', id: parseInt(this.etl.layer), internal: true }, 'coe-wildland-fire')}`
        }

        if (!this.etl.token) throw new Error('No ETL Token Provided');
    }

    async control(): Promise<void> {
        return;
    }

    async capabilities(): Promise<Static<typeof Capabilities>> {
        return {
            name: this.constructor.name,
            // @ts-expect-error Typescript doesn't handle this yet
            version: this.constructor.version,
            // @ts-expect-error Typescript doesn't handle this yet
            invocation: this.constructor.invocation,
            schema: {
                input: await this.schema(SchemaType.Input),
                output: await this.schema(SchemaType.Output)
            }
        }
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
    async schema(type: SchemaType = SchemaType.Input): Promise<TSchema> {
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
    }

    /**
     * Arbitrary JSON objects occasionally need to get typed as part of an ETL
     * This function provides the ability to strictly type unknown objects at runtime
     */
    type<T extends TSchema = TUnknown>(type: T, body: unknown): Static<T> {
        const typeChecker = TypeCompiler.Compile(type)
        const result = typeChecker.Check(body);

        if (result) return body;

        const errors = typeChecker.Errors(body);
        const firstError = errors.First();

        throw new Error(`Internal Validation Error: ${JSON.stringify(firstError)} -- Body: ${JSON.stringify(body)}`);
    }

    webhooks() {
        const app = express();

        const schema = new Schema(express.Router(), {
            logging: true,
            limit: 50
        });

        app.use(schema.router);

        // @ts-expect-error Typescript doesn't handle this yet
        if (this.constructor.webhooks) {
            // @ts-expect-error Typescript doesn't handle this yet
            this.constructor.webhooks(schema);
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
        if (!this.layer) await this.fetchLayer();

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
    async env<T extends TSchema = TUnknown>(type: T): Promise<Static<T>> {
        if (!this.layer) await this.fetchLayer();

        const env = this.layer.environment;

        Value.Default(type, env)
        Value.Clean(type, env)
        const result = Value.Check(type, env)

        if (result) return env;

        const errors = Value.Errors(type, env);

        const firstError = errors.First();

        throw new Error(`Internal Validation Error: ${JSON.stringify(firstError)} -- Body: ${JSON.stringify(env)}`);
    }

    /**
     * Set ephemeral key/values
     * Overwrites existing values, if any
     *
     * @returns A Layer Config Object
     */
    async setEphemeral(ephem: Record<string, string>): Promise<void> {
        const url = new URL(`/api/connection/${this.layer.connection}/layer/${this.layer.id}/ephemeral`, this.etl.api);
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
    async submit(fc: Static<typeof InputFeatureCollection>): Promise<boolean> {
        if (!this.layer) await this.fetchLayer();

        if (!this.layer.schema || !this.layer.schema.properties) {
            this.layer.schema = Type.Object({})
        }

        const fields = Object.keys(this.layer.schema.properties).filter((k) => {
            if (!this.layer.schema.properties[k]) return false;
            return this.layer.schema.properties[k].format === 'date-time';
        });

        // Postprocessing Functions have been defined
        if (Object.keys(this.layer.config).length) {
            const cnf = this.layer.config;
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
                    console.error(await postreq.text());
                    throw new Error('Failed to post layer to ETL');
                } else {
                    console.log(await postreq.json());
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
    EventType,
    SchemaType,
    Capabilities,
    InvocationType,
    Feature,
    fetch,
};

