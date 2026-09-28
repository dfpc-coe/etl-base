import test, { mock } from 'node:test';
import assert from 'node:assert';
import S3 from '@aws-sdk/client-s3';
import TaskBase, { Email, InvocationType, handler } from '../index.js';
import type { EmailMessage } from '../index.js';

process.env.ETL_API = 'http://localhost:5001';
process.env.ETL_LAYER = '1';
process.env.ETL_TOKEN = 'etl.token';

const raw = [
    'From: "CAD System" <cad@county.gov>',
    'To: Layer <aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa@mail.map.example.com>, Team: one@example.com, two@example.com;',
    'Cc: chief@agency.org',
    'Subject: =?UTF-8?Q?Structure_Fire_=E2=80=93_123_Main_St?=',
    'Date: Mon, 28 Sep 2026 15:00:00 +0000',
    'Message-ID: <abc@county.gov>',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="outer"',
    '',
    '--outer',
    'Content-Type: multipart/alternative; boundary="inner"',
    '',
    '--inner',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Engine 1 respond to 123 Main St',
    '--inner',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<p>Engine 1 respond to <b>123 Main St</b></p>',
    '--inner--',
    '--outer',
    'Content-Type: text/csv; name="units.csv"',
    'Content-Disposition: attachment; filename="units.csv"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from('unit,status\nE1,enroute\n').toString('base64'),
    '--outer--',
    '',
].join('\r\n');

class EmailTask extends TaskBase {
    static invocation = [InvocationType.Email];

    messages: Array<EmailMessage> = [];

    async email(message: EmailMessage): Promise<void> {
        this.messages.push(message);
    }
}

class ScheduleTask extends TaskBase {
    static invocation = [InvocationType.Schedule];
}

function stubS3(body: string | undefined): Array<unknown> {
    const inputs: Array<unknown> = [];

    mock.method(S3.S3Client.prototype, 'send', async (command: { input: unknown }) => {
        inputs.push(command.input);

        return {
            Body: body === undefined ? undefined : {
                transformToByteArray: async () => new Uint8Array(Buffer.from(body)),
            },
        };
    });

    return inputs;
}

test('Email.parse: multipart message with attachment', async () => {
    const message = await Email.parse(Buffer.from(raw), 'local.eml');

    assert.equal(message.id, 'local.eml');
    assert.deepEqual(message.from, { name: 'CAD System', address: 'cad@county.gov' });
    assert.deepEqual(message.to, [
        { name: 'Layer', address: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa@mail.map.example.com' },
        { name: '', address: 'one@example.com' },
        { name: '', address: 'two@example.com' },
    ]);
    assert.deepEqual(message.cc, [{ name: '', address: 'chief@agency.org' }]);
    assert.equal(message.subject, 'Structure Fire – 123 Main St');
    assert.equal(message.date, '2026-09-28T15:00:00.000Z');
    assert.equal(message.text?.trim(), 'Engine 1 respond to 123 Main St');
    assert.match(String(message.html), /<b>123 Main St<\/b>/);
    assert.equal(message.headers.find((header) => header.key === 'message-id')?.value, '<abc@county.gov>');

    assert.equal(message.attachments.length, 1);
    assert.equal(message.attachments[0].filename, 'units.csv');
    assert.equal(message.attachments[0].mimeType, 'text/csv');
    assert.equal(message.attachments[0].disposition, 'attachment');
    assert.equal(message.attachments[0].content.toString(), 'unit,status\nE1,enroute\n');

    assert.equal(message.raw.toString(), raw);
    assert.equal(message.ses, undefined);
});

test('Email.parse: plain message without optional headers', async () => {
    const message = await Email.parse('Subject: Test\r\n\r\nBody\r\n');

    assert.equal(message.id, '');
    assert.equal(message.from, null);
    assert.deepEqual(message.to, []);
    assert.deepEqual(message.cc, []);
    assert.equal(message.subject, 'Test');
    assert.equal(message.date, null);
    assert.equal(message.text?.trim(), 'Body');
    assert.equal(message.html, null);
    assert.deepEqual(message.attachments, []);
});

test('handler: email event is fetched, parsed & delivered to email()', async () => {
    const inputs = stubS3(raw);

    try {
        const task = new EmailTask();

        await handler(task, {
            type: 'email',
            bucket: 'tak-cloudtak-mail-prod',
            key: 'message-id',
            mail: { messageId: 'message-id', source: 'bounce@county.gov' },
            receipt: { recipients: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa@mail.map.example.com'] },
        });

        assert.deepEqual(inputs, [{ Bucket: 'tak-cloudtak-mail-prod', Key: 'message-id' }]);

        assert.equal(task.messages.length, 1);
        assert.equal(task.messages[0].id, 'message-id');
        assert.equal(task.messages[0].from?.address, 'cad@county.gov');
        assert.deepEqual(task.messages[0].ses, {
            mail: { messageId: 'message-id', source: 'bounce@county.gov' },
            receipt: { recipients: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa@mail.map.example.com'] },
        });
    } finally {
        mock.restoreAll();
    }
});

test('handler: email event requires the Email invocation', async () => {
    const inputs = stubS3(raw);

    try {
        await assert.rejects(handler(new ScheduleTask(), {
            type: 'email',
            bucket: 'tak-cloudtak-mail-prod',
            key: 'message-id',
        }), /Email Invocation type is not configured/);

        assert.equal(inputs.length, 0);
    } finally {
        mock.restoreAll();
    }
});

test('handler: email event requires a bucket & key', async () => {
    const inputs = stubS3(raw);

    try {
        await assert.rejects(handler(new EmailTask(), {
            type: 'email',
            bucket: 'tak-cloudtak-mail-prod',
        }), /Internal Validation Error/);

        assert.equal(inputs.length, 0);
    } finally {
        mock.restoreAll();
    }
});

test('handler: email event with an empty object', async () => {
    stubS3(undefined);

    try {
        await assert.rejects(handler(new EmailTask(), {
            type: 'email',
            bucket: 'tak-cloudtak-mail-prod',
            key: 'message-id',
        }), /Email message-id is empty/);
    } finally {
        mock.restoreAll();
    }
});

test('capabilities: email invocation & defaults are reported', async () => {
    class DefaultsTask extends EmailTask {
        static invocationDefaults = { email: { enabled: true } };
    }

    const capabilities = await new DefaultsTask().capabilities();

    assert.deepEqual(capabilities.incoming?.invocation, ['email']);
    assert.deepEqual(capabilities.incoming?.invocationDefaults, { email: { enabled: true } });
});
