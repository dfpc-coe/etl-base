import { FeatureCollection } from 'geojson';
import { JSONSchema6 } from 'json-schema';
import jwt from 'jsonwebtoken';

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
    memory: number;
    timeout: number;

    data: number | null;
    connection: number | null;
}

export default class TaskBase {
    etl: TaskBaseSettings;

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
    constructor() {
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
    static async schema(type: SchemaType = SchemaType.Input): Promise<JSONSchema6> {
        if (type === SchemaType.Input) {
            return {
                type: 'object',
                properties: {
                    'DEBUG': {
                        type: 'boolean',
                        default: false,
                        description: 'Print results in logs'
                    }
                }
            };
        } else {
            return {
                type: 'object',
                required: [],
                additionalProperties: true,
                properties: {}
            };
        }
    }

    async fetch(url: string, method: string, body: object): Promise<object> {
        console.log(`ok - ${method}: ${url}`);
        const res = await fetch(new URL(url, this.etl.api), {
            method,
            headers: {
                'Authorization': `Bearer ${this.etl.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            console.error(await res.text());
            throw new Error('Failed to make request to API');
        } else {
            return await res.json();
        }
    }

    /**
     * Post an Alert to the Layer Alert API
     *
     * @returns The Response from the Layer Alert API
     */
    async alert(alertin: TaskLayerAlert): Promise<object> {
        console.log(`ok - Generating Alert`);

        const alert = await fetch(new URL(`/api/layer/${this.etl.layer}/alert`, this.etl.api), {
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
            return await alert.json();
        }
    }

    /**
     * Get all information about the layer being processed
     * most importantly the user-defined `environment` object
     *
     * @returns A Layer Config Object
     */
    async layer(): Promise<TaskLayer> {
        console.log(`ok - GET ${new URL(`/api/layer/${this.etl.layer}`, this.etl.api)}`);
        const layer = await fetch(new URL(`/api/layer/${this.etl.layer}`, this.etl.api), {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${this.etl.token}`,
            }
        });

        if (!layer.ok) {
            console.error(await layer.text());
            throw new Error('Failed to get layer from ETL');
        } else {
            const json = await layer.json();

            return {
                id: json.id,
                name: json.name,
                created: json.created,
                updated: json.updatd,
                description: json.description,
                enabled: json.enabled,
                enabled_styles: json.enabled_styles,
                styles: json.styles,
                logging: json.logging,
                stale: json.stale,
                task: json.task,
                cron: json.cron,
                environment: json.environment,
                memory: json.memory,
                timeout: json.timeout,
                data: json.data || null,
                connection: json.connection || null,
            }
        }
    }

    /**
     * Submit a GeoJSON Feature collection to be submitted to the TAK Server as CoTs
     *
     * @returns A boolean representing the success state
     */
    async submit(fc: FeatureCollection): Promise<boolean> {
        console.log(`ok - posting ${fc.features.length} features`);

        if (process.env.DEBUG) for (const feat of fc.features) console.error(JSON.stringify(feat));

        if (!fc.features.length) return true;

        // Store feats as buffers
        const pre = Buffer.from('{"type":"FeatureCollection","features":[');
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
