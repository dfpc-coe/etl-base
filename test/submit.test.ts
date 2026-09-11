import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Type } from '@sinclair/typebox';
import type { Static, TSchema } from '@sinclair/typebox';
import TaskBase, { SchemaType, DataFlowType } from '../index.js';
import type { NamedSchema, SubmitRecords } from '../index.js';
import { TaskLayer } from '../src/types.js';

type CapturedRequest = {
    method: string;
    url: string;
    auth: string | undefined;
    body: unknown;
};

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

function mockLayer(): Static<typeof TaskLayer> {
    return {
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

test('submit: a record submission is posted to /layer/:layer/submit', async () => {
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
    assert.ok(Array.isArray(body.items));
    assert.deepEqual(
        body.items.sort((a, b) => String(a.serial).localeCompare(String(b.serial))),
        [{ serial: 'DJI-1', battery: 88 }, { serial: 'DJI-2', battery: 12 }],
    );
});

test('submit: record batches over submit_size are split across posts', async () => {
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
        assert.ok(Array.isArray(body.items));
        seen.push(...(body.items as unknown as Array<{ i: number }>).map((record) => record.i));
    }

    assert.deepEqual(seen.sort(), [1, 2, 3]);
});

test('submit: the input items array is not mutated', async () => {
    requests.length = 0;

    const task = new Task();
    task.layer = mockLayer();

    const input = {
        schema: 'telemetry',
        items: [{ i: 1 }, { i: 2 }],
    };

    await task.submit(input);

    assert.deepEqual(input.items, [{ i: 1 }, { i: 2 }]);
});

test('submit: a record larger than submit_size is posted alone as valid JSON', async () => {
    requests.length = 0;

    const task = new Task();
    task.layer = mockLayer();
    task.etl.config.submit_size = 40;

    // The oversized record is popped first, hitting an empty batch - without
    // the batch-of-one handling this posted an empty items array and then
    // corrupted the record on the comma-stripping restart
    const result = await task.submit({
        schema: 'telemetry',
        items: [{ i: 1 }, { i: 2 }, { blob: 'x'.repeat(64) }],
    });

    assert.equal(result, true);
    assert.equal(requests.length, 3);

    const seen = [];
    for (const request of requests) {
        const body = request.body as SubmitRecords;
        assert.equal(body.schema, 'telemetry');
        assert.ok(Array.isArray(body.items));
        assert.ok(body.items.length > 0, 'no post should carry an empty items array');
        seen.push(...body.items);
    }

    assert.equal(seen.length, 3);
    assert.ok(seen.some((record) => record.blob === 'x'.repeat(64)));
});

test('submit: a missing or empty schema is rejected', async () => {
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

test('submit: non-array items are rejected', async () => {
    const task = new Task();
    task.layer = mockLayer();

    await assert.rejects(
        task.submit({ schema: 'telemetry', items: { i: 1 } } as unknown as SubmitRecords),
        /Record submissions must provide an items array/,
    );
});

test('submit: a bare array is rejected', async () => {
    const task = new Task();
    task.layer = mockLayer();

    await assert.rejects(
        task.submit([{ i: 1 }] as unknown as SubmitRecords),
        /Record submissions must be provided as { schema: string, items: \[...\] }/,
    );
});

test('submit: a FeatureCollection is still posted to /layer/:layer/cot', async () => {
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
        features: [{
            id: 'feat-2',
            type: 'Feature',
            properties: {},
            geometry: {
                type: 'Point',
                coordinates: [-105, 40],
            },
        }],
    });

    assert.equal(result, true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/layer/1/cot?archive=true');
});

test('submit: teardown mock CloudTAK API', async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
});
