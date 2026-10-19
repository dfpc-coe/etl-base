import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Static } from '@sinclair/typebox';
import TaskBase from '../index.js';
import { TaskLayer } from '../src/types.js';

class Task extends TaskBase {}

function mockLayer(permissions: Array<string>): Static<typeof TaskLayer> {
    return {
        connection: 5,
        permissions,
    } as unknown as Static<typeof TaskLayer>;
}

const layerBody = {
    id: 1,
    status: 'unknown',
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-01T00:00:00.000Z',
    connection: 5,
    username: null,
    uuid: '00000000-0000-0000-0000-000000000000',
    name: 'Permissions Layer',
    description: '',
    enabled: true,
    logging: false,
    task: 'Task-v1.0.0',
    memory: 128,
    timeout: 60,
    priority: 'off',
    permissions: ['video:read', 'event:*'],
    alarm_period: 30,
    alarm_evals: 5,
    alarm_points: 4,
};

test('hasPermission', async (t) => {
    const server = http.createServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(req.url === '/api/layer/1' ? layerBody : { status: 404, message: 'Not Found' }));
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));

    process.env.ETL_API = `http://localhost:${(server.address() as AddressInfo).port}`;
    process.env.ETL_LAYER = '1';
    process.env.ETL_TOKEN = 'etl.test';

    t.after(() => server.close());

    await t.test('exact scope', async () => {
        const task = new Task();
        task.layer = mockLayer(['video:read']);

        assert.equal(await task.hasPermission('video:read'), true);
        assert.equal(await task.hasPermission('video:create'), false);
        assert.equal(await task.hasPermission('event:read'), false);
    });

    await t.test('wildcard scope', async () => {
        const task = new Task();
        task.layer = mockLayer(['event:*']);

        assert.equal(await task.hasPermission('event:read'), true);
        assert.equal(await task.hasPermission('event:delete'), true);
        assert.equal(await task.hasPermission('video:read'), false);
    });

    await t.test('wildcard request matches only the wildcard grant', async () => {
        const task = new Task();
        task.layer = mockLayer(['video:read', 'video:create', 'event:*']);

        assert.equal(await task.hasPermission('video:*'), false);
        assert.equal(await task.hasPermission('event:*'), true);
    });

    await t.test('no permissions', async () => {
        const task = new Task();
        task.layer = mockLayer([]);

        assert.equal(await task.hasPermission('feature:submit'), false);
    });

    await t.test('unknown scope throws', async () => {
        const task = new Task();
        task.layer = mockLayer(['video:*']);

        await assert.rejects(task.hasPermission('video:fly'), /Unknown Permission: video:fly/);
        await assert.rejects(task.hasPermission('spaceship:read'), /Unknown Permission: spaceship:read/);
        await assert.rejects(task.hasPermission('video'), /Unknown Permission: video/);
    });

    await t.test('fetches the Layer when not yet loaded', async () => {
        const task = new Task();

        assert.equal(await task.hasPermission('video:read'), true);
        assert.equal(await task.hasPermission('event:update'), true);
        assert.equal(await task.hasPermission('device:read'), false);
        assert.deepEqual(task.layer?.permissions, ['video:read', 'event:*']);
    });

    await t.test('fetchLayer rejects a Layer without permissions', async () => {
        const stripped = http.createServer((req, res) => {
            res.setHeader('Content-Type', 'application/json');
            const { permissions, ...rest } = layerBody;
            void permissions;
            res.end(JSON.stringify(rest));
        });

        await new Promise<void>((resolve) => stripped.listen(0, resolve));

        const api = process.env.ETL_API;
        process.env.ETL_API = `http://localhost:${(stripped.address() as AddressInfo).port}`;

        try {
            const task = new Task();
            await assert.rejects(task.fetchLayer(), /Internal Validation Error/);
        } finally {
            process.env.ETL_API = api;
            stripped.close();
        }
    });
});
