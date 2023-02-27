import { FeatureCollection } from 'geojson';

export interface TaskBaseSettings {
    api: string;
    layer: string;
    token: string;
}

export default class TaskBase {
    etl: TaskBaseSettings;

    constructor() {
        this.etl = {
            api: process.env.ETL_API || '',
            layer: process.env.ETL_LAYER || '',
            token: process.env.ETL_TOKEN || ''
        };

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

    async layer(): Promise<object> {
        return await fetch(new URL(`/api/layer/${this.etl.layer}`, this.etl.api), {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${this.etl.token}`,
            }
        });
    }

    async submit(fc: FeatureCollection): Promise<boolean> {
        console.log(`ok - filtered to ${fc.features.length} planes`);

        if (process.env.DEBUG) for (const feat of fc.features) console.error(JSON.stringify(feat));

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
