import test from 'node:test';
import assert from 'node:assert';
import type { Server } from 'node:http';
import { Type } from '@sinclair/typebox';
import type Schema from '@openaddresses/batch-schema';
import TaskBase, { DataFlowType, InvocationType } from '../index.js';

process.env.ETL_API = 'http://localhost:5001';
process.env.ETL_LAYER = '1';
process.env.ETL_TOKEN = 'etl.token';

type Seen = { rawBody?: string, body: unknown, type?: string };

class WebhookTask extends TaskBase {
    static name = 'webhook-task';
    static flow = [DataFlowType.Incoming];
    static invocation = [InvocationType.Webhook];

    static seen: Seen[] = [];

    static webhooks = async (schema: Schema): Promise<void> => {
        await schema.post('/:webhookid', {
            name: 'Webhook',
            group: 'Webhook',
            params: Type.Object({ webhookid: Type.String() }),
            body: {
                'application/x-www-form-urlencoded': Type.Object({ payload: Type.String(), extra: Type.String() }),
                'application/json': Type.Object({ hello: Type.String(), n: Type.Integer() })
            },
            res: Type.Object({ status: Type.Integer() })
        }, (req, res) => {
            WebhookTask.seen.push({
                rawBody: req.rawBody?.toString(),
                body: req.body,
                type: req.headers['content-type']
            });

            res.json({ status: 200 });
        });
    };
}

async function serve(task: TaskBase): Promise<{ server: Server, url: string }> {
    const app = await task.controlWebhooks();

    return await new Promise((resolve) => {
        const server = app.listen(0, () => {
            const address = server.address();
            if (!address || typeof address === 'string') throw new Error('No port');
            resolve({ server, url: `http://127.0.0.1:${address.port}` });
        });
    });
}

test('controlWebhooks - rawBody kept for form & JSON bodies when enabled', async () => {
    WebhookTask.seen = [];
    const { server, url } = await serve(new WebhookTask(undefined, { logging: { webhooks: false }, webhooks: { rawBody: true } }));

    try {
        const form = 'payload=%7B%22type%22%3A%22block_actions%22%7D&extra=a+b';

        const formRes = await fetch(`${url}/hook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: form
        });

        assert.equal(formRes.status, 200);

        const json = '{"hello": "world", "n": 1}';

        const jsonRes = await fetch(`${url}/hook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: json
        });

        assert.equal(jsonRes.status, 200);

        assert.deepEqual(WebhookTask.seen, [{
            rawBody: form,
            body: { payload: '{"type":"block_actions"}', extra: 'a b' },
            type: 'application/x-www-form-urlencoded'
        }, {
            rawBody: json,
            body: { hello: 'world', n: 1 },
            type: 'application/json'
        }]);
    } finally {
        server.close();
    }
});

test('controlWebhooks - rawBody absent by default', async () => {
    WebhookTask.seen = [];
    const { server, url } = await serve(new WebhookTask(undefined, { logging: { webhooks: false } }));

    try {
        const res = await fetch(`${url}/hook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{"hello": "world", "n": 1}'
        });

        assert.equal(res.status, 200);
        assert.deepEqual(WebhookTask.seen, [{
            rawBody: undefined,
            body: { hello: 'world', n: 1 },
            type: 'application/json'
        }]);
    } finally {
        server.close();
    }
});
