import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Type } from '@sinclair/typebox';
import type { Static, TSchema } from '@sinclair/typebox';
import TaskBase, { SchemaType, DataFlowType } from '../index.js';
import type { NamedSchema, SubmitFeatureCollection, SubmitRecords } from '../index.js';
import { TaskLayer } from '../src/types.js';

type CapturedRequest = {
    method: string;
    url: string;
    auth: string | undefined;
    body: unknown;
};

type SubmitBody = Static<typeof SubmitFeatureCollection>;

const requests: Array<CapturedRequest> = [];

const server = http.createServer((req, res) => {
    const chunks: Array<Buffer> = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
        requests.push({
            method: req.method || '',
            url: req.url || '',
            auth: req.headers.authorization,
            body: JSON.parse(Buffer.concat(chunks).toString() || 'null'),
        });

        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ status: 200, message: 'Submitted', errors: [] }));
    });
});

function mockLayer(connection: number | null = 5): Static<typeof TaskLayer> {
    return {
        connection,
        incoming: {
            config: {},
        },
    } as unknown as Static<typeof TaskLayer>;
}

class Task extends TaskBase {}

const telemetrySchema = Type.Object({
    serial: Type.String(),
    battery: Type.Number(),
});

const alertSchema = Type.Object({
    serial: Type.String(),
    message: Type.String(),
});

class MultiSchemaTask extends TaskBase {
    async schema(
        type: SchemaType = SchemaType.Input,
        flow: DataFlowType = DataFlowType.Incoming
    ): Promise<TSchema | Array<NamedSchema>> {
        if (type === SchemaType.Output && flow === DataFlowType.Incoming) {
            return [
                { id: 'telemetry', schema: telemetrySchema },
                { id: 'alerts', schema: alertSchema },
            ];
        }

        return await super.schema(type, flow);
    }
}

test('submit: setup mock CloudTAK API', async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;

    process.env.ETL_API = `http://127.0.0.1:${address.port}`;
    process.env.ETL_LAYER = '1';
    process.env.ETL_TOKEN = 'etl.test-token';
});

test('submit: a schema FeatureCollection is posted to /connection/:connection/submit', async () => {
    requests.length = 0;

    const task = new Task();
    task.layer = mockLayer();

    const result = await task.submit({
        type: 'FeatureCollection',
        schema: 'telemetry',
        features: [{
            id: 'DJI-1',
            type: 'Feature',
            properties: { callsign: 'DJI-1', metadata: { battery: 88 } },
        }, {
            id: 'DJI-2',
            type: 'Feature',
            properties: { callsign: 'DJI-2', metadata: { battery: 12 } },
            geometry: null,
        }, {
            id: 'DJI-3',
            type: 'Feature',
            properties: { callsign: 'DJI-3' },
            geometry: { type: 'Point', coordinates: [-105, 40] },
        }],
    });

    assert.equal(result, true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].url, '/api/connection/5/submit?archive=true');
    assert.equal(requests[0].auth, 'Bearer etl.test-token');

    const body = requests[0].body as SubmitBody;
    assert.equal(body.type, 'FeatureCollection');
    assert.equal(body.schema, 'telemetry');
    assert.deepEqual(body.uids, ['DJI-1', 'DJI-2', 'DJI-3']);

    const byId = new Map(body.features.map((f) => [f.id, f]));
    assert.equal(byId.size, 3);
    assert.equal('geometry' in byId.get('DJI-1')!, false);
    assert.equal(byId.get('DJI-2')!.geometry, null);
    assert.deepEqual(byId.get('DJI-3')!.geometry, { type: 'Point', coordinates: [-105, 40] });
});

test('submit: archive=false is forwarded for schema submissions', async () => {
    requests.length = 0;

    const task = new Task();
    task.layer = mockLayer();

    await task.submit({
        type: 'FeatureCollection',
        schema: 'telemetry',
        features: [],
    }, { archive: false });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/connection/5/submit?archive=false');
});

test('submit: schema batches over submit_size are split and every post carries all uids', async () => {
    requests.length = 0;

    const task = new Task();
    task.layer = mockLayer();
    task.etl.config.submit_size = 160;

    const features = [1, 2, 3].map((i) => ({
        id: `f-${i}`,
        type: 'Feature' as const,
        properties: { callsign: `Feature ${i}` },
    }));

    const result = await task.submit({
        type: 'FeatureCollection',
        schema: 'telemetry',
        features,
    });

    assert.equal(result, true);
    assert.ok(requests.length > 1, 'expected the submission to be split');

    const seen = [];
    for (const request of requests) {
        assert.equal(request.url, '/api/connection/5/submit?archive=true');

        const body = request.body as SubmitBody;
        assert.equal(body.schema, 'telemetry');
        assert.deepEqual(body.uids, ['f-1', 'f-2', 'f-3']);
        assert.ok(body.features.length > 0, 'no post should carry an empty features array');
        seen.push(...body.features.map((f) => f.id));
    }

    assert.deepEqual(seen.sort(), ['f-1', 'f-2', 'f-3']);
});

test('submit: the input features array is not mutated', async () => {
    requests.length = 0;

    const task = new Task();
    task.layer = mockLayer();

    const input = {
        type: 'FeatureCollection' as const,
        schema: 'telemetry',
        features: [{
            id: 'a',
            type: 'Feature' as const,
            properties: {},
        }, {
            id: 'b',
            type: 'Feature' as const,
            properties: {},
        }],
    };

    await task.submit(input);

    assert.deepEqual(input.features.map((f) => f.id), ['a', 'b']);
});

test('submit: a feature larger than submit_size is posted alone as valid JSON', async () => {
    requests.length = 0;

    const task = new Task();
    task.layer = mockLayer();
    task.etl.config.submit_size = 160;

    const result = await task.submit({
        type: 'FeatureCollection',
        schema: 'telemetry',
        features: [{
            id: 'small-1',
            type: 'Feature',
            properties: {},
        }, {
            id: 'small-2',
            type: 'Feature',
            properties: {},
        }, {
            id: 'large',
            type: 'Feature',
            properties: { remarks: 'x'.repeat(256) },
        }],
    });

    assert.equal(result, true);

    const seen = [];
    for (const request of requests) {
        const body = request.body as SubmitBody;
        assert.ok(body.features.length > 0, 'no post should carry an empty features array');
        seen.push(...body.features);
    }

    assert.equal(seen.length, 3);
    assert.ok(seen.some((f) => f.properties.remarks === 'x'.repeat(256)));
});

test('submit: an empty schema string is rejected', async () => {
    const task = new Task();
    task.layer = mockLayer();

    await assert.rejects(
        task.submit({ type: 'FeatureCollection', schema: '', features: [] }),
        /Schema submissions must provide a non-empty schema string/,
    );
});

test('submit: a schema submission requires the Layer to belong to a Connection', async () => {
    const task = new Task();
    task.layer = mockLayer(null);

    await assert.rejects(
        task.submit({ type: 'FeatureCollection', schema: 'telemetry', features: [] }),
        /Layer is not attached to a Connection/,
    );
});

test('submit: non-FeatureCollection input is rejected', async () => {
    const task = new Task();
    task.layer = mockLayer();

    await assert.rejects(
        task.submit([{ i: 1 }] as unknown as SubmitBody),
        /Submissions must be provided as a GeoJSON FeatureCollection/,
    );

    await assert.rejects(
        task.submit({ schema: 'telemetry' } as unknown as SubmitBody),
        /Submissions must be provided as a GeoJSON FeatureCollection/,
    );
});

test('submit: a FeatureCollection without a type field is still accepted', async () => {
    requests.length = 0;

    const task = new Task();
    task.layer = mockLayer();

    await task.submit({
        schema: 'telemetry',
        features: [{ id: 'untyped', type: 'Feature', properties: {} }],
    } as unknown as SubmitBody);

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/connection/5/submit?archive=true');
    assert.deepEqual((requests[0].body as SubmitBody).uids, ['untyped']);
});

test('submit (deprecated): a record submission is still posted to /layer/:layer/submit', async () => {
    requests.length = 0;

    const task = new Task();
    task.layer = mockLayer();

    const result = await task.submit({
        schema: 'telemetry',
        items: [
            { serial: 'DJI-1', battery: 88 },
            { serial: 'DJI-2', battery: 12 },
        ],
    });

    assert.equal(result, true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].url, '/api/layer/1/submit');
    assert.equal(requests[0].auth, 'Bearer etl.test-token');

    const body = requests[0].body as SubmitRecords;
    assert.equal(body.schema, 'telemetry');
    assert.deepEqual(
        body.items.sort((a, b) => String(a.serial).localeCompare(String(b.serial))),
        [{ serial: 'DJI-1', battery: 88 }, { serial: 'DJI-2', battery: 12 }],
    );
});

test('submit (deprecated): record batches over submit_size are split across posts', async () => {
    requests.length = 0;

    const task = new Task();
    task.layer = mockLayer();
    task.etl.config.submit_size = 40;

    const result = await task.submit({
        schema: 'telemetry',
        items: [{ i: 1 }, { i: 2 }, { i: 3 }],
    });

    assert.equal(result, true);
    assert.equal(requests.length, 3);

    const seen = [];
    for (const request of requests) {
        assert.equal(request.url, '/api/layer/1/submit');

        const body = request.body as SubmitRecords;
        assert.equal(body.schema, 'telemetry');
        assert.ok(body.items.length > 0, 'no post should carry an empty items array');
        seen.push(...(body.items as unknown as Array<{ i: number }>).map((record) => record.i));
    }

    assert.deepEqual(seen.sort(), [1, 2, 3]);
});

test('submit (deprecated): a missing or empty schema is rejected', async () => {
    const task = new Task();
    task.layer = mockLayer();

    await assert.rejects(
        task.submit({ items: [{ i: 1 }] } as unknown as SubmitRecords),
        /Record submissions must provide a non-empty schema string/,
    );

    await assert.rejects(
        task.submit({ schema: '', items: [{ i: 1 }] }),
        /Record submissions must provide a non-empty schema string/,
    );
});

test('submit (deprecated): non-array items are rejected', async () => {
    const task = new Task();
    task.layer = mockLayer();

    await assert.rejects(
        task.submit({ schema: 'telemetry', items: { i: 1 } } as unknown as SubmitRecords),
        /Record submissions must provide an items array/,
    );
});

test('submit: a FeatureCollection without a schema is still posted to /layer/:layer/cot', async () => {
    requests.length = 0;

    const task = new Task();
    task.layer = mockLayer();

    const result = await task.submit({
        type: 'FeatureCollection',
        features: [{
            id: 'feat-1',
            type: 'Feature',
            properties: {
                callsign: 'Test Feature',
            },
            geometry: {
                type: 'Point',
                coordinates: [-105, 40],
            },
        }],
    });

    assert.equal(result, true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].url, '/api/layer/1/cot?archive=true');
    assert.equal(requests[0].auth, 'Bearer etl.test-token');

    const body = requests[0].body as { type: string; uids: Array<string>; features: Array<{ id: string }> };
    assert.equal(body.type, 'FeatureCollection');
    assert.deepEqual(body.uids, ['feat-1']);
    assert.equal(body.features.length, 1);
    assert.equal(body.features[0].id, 'feat-1');
});

test('schema: multiple named Output schemas surface in capabilities', async () => {
    const task = new MultiSchemaTask();

    const capabilities = await task.capabilities();

    assert.ok(capabilities.incoming);
    assert.deepEqual(capabilities.incoming.schema.output, [
        { id: 'telemetry', schema: telemetrySchema },
        { id: 'alerts', schema: alertSchema },
    ]);
    assert.equal(capabilities.incoming.schema.outputError, undefined);
});

test('schema: a FeatureCollection submits under multiple named Output schemas', async () => {
    requests.length = 0;

    const task = new MultiSchemaTask();
    task.layer = mockLayer();

    const result = await task.submit({
        type: 'FeatureCollection',
        schema: 'alerts',
        features: [{
            id: 'feat-2',
            type: 'Feature',
            properties: {},
        }],
    });

    assert.equal(result, true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/connection/5/submit?archive=true');
    assert.equal((requests[0].body as SubmitBody).schema, 'alerts');
});

test('submit: teardown mock CloudTAK API', async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
});
