import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import jwt from 'jsonwebtoken';
import Err from '@openaddresses/batch-error';
import CloudTAKAPI, { EntityKind } from '../src/sdk/api.js';
import { APIAuth, APIAuthToken, APIAuthLayer, DEFAULT_LAYER_SECRET } from '../src/sdk/auth.js';
import type { CoreEvent, CoreDevice, CoreEventAssignment } from '../src/sdk/api/types.js';
import TaskBase from '../index.js';

type CapturedRequest = {
    method: string;
    url: string;
    auth: string | undefined;
    contentType: string | undefined;
    body: unknown;
};

const requests: Array<CapturedRequest> = [];

let forced: null | { status: number; body: unknown; contentType?: string } = null;

const server = http.createServer((req, res) => {
    const chunks: Array<Buffer> = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
        const raw = Buffer.concat(chunks).toString();

        requests.push({
            method: req.method || '',
            url: req.url || '',
            auth: req.headers.authorization,
            contentType: req.headers['content-type'],
            body: raw ? JSON.parse(raw) : null,
        });

        if (forced) {
            res.statusCode = forced.status;
            res.setHeader('Content-Type', forced.contentType || 'application/json');
            res.end(typeof forced.body === 'string' ? forced.body : JSON.stringify(forced.body));
            forced = null;
            return;
        }

        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ id: 'echo', method: req.method, url: req.url }));
    });
});

let base = '';

function last(): CapturedRequest {
    const req = requests.at(-1);
    assert.ok(req, 'a request was made');
    return req;
}

test('start server', async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test('CloudTAKAPI: constructor accepts a string or URL and defaults to no auth', () => {
    const api = new CloudTAKAPI(base);
    assert.equal(api.url.href, `${base}/`);
    assert.ok(api.auth instanceof APIAuth);
    assert.equal(new CloudTAKAPI(new URL(base)).url.href, `${base}/`);
});

test('CloudTAKAPI.stdurl: resolves fragments and passes full URLs through', () => {
    const api = new CloudTAKAPI('https://cloudtak.example.com');
    assert.equal(api.stdurl('/api/core/event').href, 'https://cloudtak.example.com/api/core/event');
    assert.equal(api.stdurl('https://other.example.com/x').href, 'https://other.example.com/x');
});

test('CloudTAKAPI.fromEnv: reads ETL_API & ETL_TOKEN', () => {
    const api = CloudTAKAPI.fromEnv({ ETL_API: base, ETL_TOKEN: 'etl.abc' });
    assert.equal(api.url.href, `${base}/`);
    assert.ok(api.auth instanceof APIAuthToken);
    assert.equal((api.auth as APIAuthToken).token, 'etl.abc');

    assert.throws(() => CloudTAKAPI.fromEnv({ ETL_TOKEN: 'etl.abc' }), /No ETL_API Provided/);
    assert.throws(() => CloudTAKAPI.fromEnv({ ETL_API: base }), /No ETL_TOKEN Provided/);
});

test('CloudTAKAPI.init: calls auth.init', async () => {
    let initialized: CloudTAKAPI | undefined;

    class Custom extends APIAuth {
        async init(api: CloudTAKAPI) {
            initialized = api;
        }
    }

    const api = await CloudTAKAPI.init(base, new Custom());
    assert.equal(initialized, api);
});

test('APIAuthLayer: signs an etl.<jwt> Layer token', () => {
    const auth = new APIAuthLayer(12);
    assert.equal(auth.layer, 12);
    assert.ok(auth.token.startsWith('etl.'));

    const payload = jwt.verify(auth.token.replace(/^etl\./, ''), DEFAULT_LAYER_SECRET) as Record<string, unknown>;
    assert.equal(payload.access, 'layer');
    assert.equal(payload.id, 12);
    assert.equal(payload.internal, true);

    const custom = APIAuthLayer.sign(3, 'another-secret');
    assert.throws(() => jwt.verify(custom.replace(/^etl\./, ''), DEFAULT_LAYER_SECRET));
    assert.equal((jwt.verify(custom.replace(/^etl\./, ''), 'another-secret') as Record<string, unknown>).id, 3);
});

test('Event.get: GET /api/core/event/:event with a Bearer token', async () => {
    const api = new CloudTAKAPI(base, new APIAuthToken('etl.token'));

    const event = await api.Event.get('a/b c');

    assert.equal(last().method, 'GET');
    assert.equal(last().url, '/api/core/event/a%2Fb%20c');
    assert.equal(last().auth, 'Bearer etl.token');
    assert.equal(last().contentType, undefined);
    assert.equal((event as unknown as { id: string }).id, 'echo');
});

test('APIAuthToken: does not override an explicit Authorization header', async () => {
    const api = new CloudTAKAPI(base, new APIAuthToken('etl.token'));

    await api.fetch('/api/core/event', { headers: { Authorization: 'Bearer other' } });

    assert.equal(last().auth, 'Bearer other');
});

test('Entity.list: serializes query parameters including repeated channels', async () => {
    const api = new CloudTAKAPI(base, new APIAuthToken('etl.token'));

    await api.Entity.list(EntityKind.EVENT, {
        limit: 10,
        page: 2,
        order: 'desc',
        sort: 'created',
        filter: 'fire',
        channel: [1, 5]
    });

    const url = new URL(last().url, base);
    assert.equal(url.pathname, '/api/core/event');
    assert.deepEqual(url.searchParams.getAll('channel'), ['1', '5']);
    assert.equal(url.searchParams.get('limit'), '10');
    assert.equal(url.searchParams.get('page'), '2');
    assert.equal(url.searchParams.get('order'), 'desc');
    assert.equal(url.searchParams.get('sort'), 'created');
    assert.equal(url.searchParams.get('filter'), 'fire');

    await api.Device.list();
    assert.equal(last().url, '/api/core/device');

    await api.Device.list({ limit: 1, channel: 7 });
    assert.equal(last().url, '/api/core/device?limit=1&channel=7');
});

test('Event.create: POST JSON body', async () => {
    const api = new CloudTAKAPI(base, new APIAuthToken('etl.token'));

    forced = {
        status: 200,
        body: { id: 'created', name: 'Fire' }
    };

    const event = await api.Event.create({
        name: 'Fire',
        type: 'a-f-G',
        priority: 'high',
        geometry: { type: 'Point', coordinates: [-105, 39] },
        location: '',
        remarks: ''
    } as Parameters<typeof api.Event.create>[0]);

    assert.equal(last().method, 'POST');
    assert.equal(last().url, '/api/core/event');
    assert.equal(last().contentType, 'application/json');
    assert.deepEqual(last().body, {
        name: 'Fire',
        type: 'a-f-G',
        priority: 'high',
        geometry: { type: 'Point', coordinates: [-105, 39] },
        location: '',
        remarks: ''
    });
    assert.equal(event.id, 'created');
});

test('Device.update: PATCH JSON body', async () => {
    const api = new CloudTAKAPI(base, new APIAuthToken('etl.token'));

    await api.Device.update('dev-1', { name: 'Camera 1' });

    assert.equal(last().method, 'PATCH');
    assert.equal(last().url, '/api/core/device/dev-1');
    assert.equal(last().contentType, 'application/json');
    assert.deepEqual(last().body, { name: 'Camera 1' });
});

test('Entity.delete: DELETE returns the StandardResponse', async () => {
    const api = new CloudTAKAPI(base, new APIAuthToken('etl.token'));

    forced = {
        status: 200,
        body: { status: 200, message: 'Device Deleted' }
    };

    const res = await api.Device.delete('dev-1');

    assert.equal(last().method, 'DELETE');
    assert.equal(last().url, '/api/core/device/dev-1');
    assert.equal(last().body, null);
    assert.deepEqual(res, { status: 200, message: 'Device Deleted' });

    await api.Entity.delete(EntityKind.EVENT, 'evt-1');
    assert.equal(last().url, '/api/core/event/evt-1');
});

test('CloudTAKAPI.fetch: throws Err with the API status & message', async () => {
    const api = new CloudTAKAPI(base, new APIAuthToken('etl.token'));

    forced = {
        status: 404,
        body: { status: 404, message: 'Event Not Found' }
    };

    await assert.rejects(api.Event.get('missing'), (err: unknown) => {
        assert.ok(err instanceof Err);
        assert.equal(err.status, 404);
        assert.equal(err.message, 'Event Not Found');
        return true;
    });

    forced = {
        status: 502,
        contentType: 'text/html',
        body: '<html>Bad Gateway</html>'
    };

    await assert.rejects(api.Event.get('missing'), (err: unknown) => {
        assert.ok(err instanceof Err);
        assert.equal(err.status, 502);
        assert.equal(err.message, '<html>Bad Gateway</html>');
        return true;
    });
});

test('CloudTAKAPI.fetch: wraps connection failures in Err', async () => {
    const api = new CloudTAKAPI('http://127.0.0.1:1', new APIAuthToken('etl.token'));

    await assert.rejects(api.Event.get('x'), (err: unknown) => {
        assert.ok(err instanceof Err);
        assert.equal(err.status, 400);
        assert.notEqual(err.message, 'fetch failed');
        return true;
    });
});

test('CloudTAKAPI.fetch: returns text for non-JSON responses', async () => {
    const api = new CloudTAKAPI(base);

    forced = {
        status: 200,
        contentType: 'text/plain',
        body: 'plain'
    };

    assert.equal(await api.fetch<string>('/anything'), 'plain');
});

test('TaskBase: exposes a CloudTAKAPI authenticated as the Layer', () => {
    process.env.ETL_API = base;
    process.env.ETL_LAYER = '7';
    process.env.ETL_TOKEN = 'etl.layer-token';

    class Task extends TaskBase {}

    const task = new Task();

    assert.ok(task.api instanceof CloudTAKAPI);
    assert.equal(task.api.url.href, `${base}/`);
    assert.equal((task.api.auth as APIAuthToken).token, 'etl.layer-token');
});

test('Assignment.list: GET /api/core/event/:event/assignment with query', async () => {
    const api = new CloudTAKAPI(base, new APIAuthToken('etl.token'));

    await api.Assignment.list('evt 1', { limit: 5, sort: 'role', order: 'asc' });

    const url = new URL(last().url, base);
    assert.equal(last().method, 'GET');
    assert.equal(url.pathname, '/api/core/event/evt%201/assignment');
    assert.equal(url.searchParams.get('limit'), '5');
    assert.equal(url.searchParams.get('sort'), 'role');
    assert.equal(url.searchParams.get('order'), 'asc');

    await api.Assignment.list('evt-1');
    assert.equal(last().url, '/api/core/event/evt-1/assignment');
});

test('Assignment.get: GET /api/core/event/:event/assignment/:assignment', async () => {
    const api = new CloudTAKAPI(base, new APIAuthToken('etl.token'));

    await api.Assignment.get('evt-1', 'asg/1');

    assert.equal(last().method, 'GET');
    assert.equal(last().url, '/api/core/event/evt-1/assignment/asg%2F1');
    assert.equal(last().auth, 'Bearer etl.token');
});

test('Assignment.create: POST JSON body', async () => {
    const api = new CloudTAKAPI(base, new APIAuthToken('etl.token'));

    forced = {
        status: 200,
        body: { id: 'asg-1', event: 'evt-1', uid: null, name: 'Alice', role: 'IC', remarks: '', created: 'c', updated: 'u' }
    };

    const assignment = await api.Assignment.create('evt-1', { name: 'Alice', role: 'IC', remarks: '' });

    assert.equal(last().method, 'POST');
    assert.equal(last().url, '/api/core/event/evt-1/assignment');
    assert.equal(last().contentType, 'application/json');
    assert.deepEqual(last().body, { name: 'Alice', role: 'IC', remarks: '' });
    assert.equal(assignment.id, 'asg-1');
    assert.equal(assignment.uid, null);
});

test('Assignment.update & delete', async () => {
    const api = new CloudTAKAPI(base, new APIAuthToken('etl.token'));

    await api.Assignment.update('evt-1', 'asg-1', { uid: 'user@example.com', role: 'Medic' });

    assert.equal(last().method, 'PATCH');
    assert.equal(last().url, '/api/core/event/evt-1/assignment/asg-1');
    assert.deepEqual(last().body, { uid: 'user@example.com', role: 'Medic' });

    forced = {
        status: 200,
        body: { status: 200, message: 'Assignment Deleted' }
    };

    const res = await api.Assignment.delete('evt-1', 'asg-1');

    assert.equal(last().method, 'DELETE');
    assert.equal(last().url, '/api/core/event/evt-1/assignment/asg-1');
    assert.equal(last().body, null);
    assert.deepEqual(res, { status: 200, message: 'Assignment Deleted' });
});

test('types: responses are typed from the OpenAPI document', () => {
    const event: Pick<CoreEvent, 'id' | 'priority' | 'geometry'> = {
        id: 'x',
        priority: 'critical',
        geometry: { type: 'Point', coordinates: [0, 0] }
    };

    const device: Pick<CoreDevice, 'id' | 'battery' | 'geometry'> = {
        id: 'y',
        battery: null,
        geometry: null
    };

    const assignment: Pick<CoreEventAssignment, 'id' | 'event' | 'uid' | 'role'> = {
        id: 'z',
        event: 'x',
        uid: null,
        role: 'IC'
    };

    assert.ok(event);
    assert.ok(device);
    assert.ok(assignment);
});

test('stop server', async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
});
