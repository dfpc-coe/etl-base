import { FeatureCollection } from 'geojson';
import jwt from 'jsonwebtoken';

export interface Event {
    type?: string
}

export interface TaskBaseSettings {
    api: string;
    layer: string;
    token: string;
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
        [k: string]: any
    };
    memory: number;
    timeout: number;

    data: number | null;
    connection: number | null;
}

export default class TaskBase {
    etl: TaskBaseSettings;

    constructor() {
        this.etl = {
            api: process.env.ETL_API || '',
            layer: process.env.ETL_LAYER || '',
            token: process.env.ETL_TOKEN || ''
        };

        // This is just a helper function for local development, signing with the (unsecure) default secret
        if (!this.etl.token && (new URL(this.etl.api)).hostname === 'localhost') {
            this.etl.token = jwt.sign({ access: 'cot', layer: parseInt(this.etl.layer) }, 'coe-wildland-fire')
        }

        if (!this.etl.api) throw new Error('No ETL API URL Provided');
        if (!this.etl.layer) throw new Error('No ETL Layer Provided');
        if (!this.etl.token) throw new Error('No ETL Token Provided');
    }

    static schema(): object {
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
    }

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

    async submit(fc: FeatureCollection): Promise<boolean> {
        console.log(`ok - posting ${fc.features.length} features`);

        if (process.env.DEBUG) for (const feat of fc.features) console.error(JSON.stringify(feat));

        console.log(`ok - POST ${new URL(`/api/layer/${this.etl.layer}/cot`, this.etl.api)}`);
        const post = await fetch(new URL(`/api/layer/${this.etl.layer}/cot`, this.etl.api), {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.etl.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(fc)
        });

        if (!post.ok) {
            console.error(await post.text());
            throw new Error('Failed to post layer to ETL');
        } else {
            console.log(await post.json());
        }

        return true;
    }
}
