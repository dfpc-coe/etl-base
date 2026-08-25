import test from 'node:test';
import assert from 'node:assert';
import type Lambda from 'aws-lambda';
import TaskBase, { OutgoingMessageType, OutgoingAction } from '../index.js';

function sqs(bodies: Array<unknown>): Lambda.SQSEvent {
    return {
        Records: bodies.map((body) => ({ body: JSON.stringify(body) } as Lambda.SQSRecord)),
    };
}

const geojson = {
    id: 'test-uid',
    type: 'Feature',
    properties: {
        type: 'a-f-G',
        how: 'm-g',
        callsign: 'Test',
        time: '2026-08-25T00:00:00.000Z',
        start: '2026-08-25T00:00:00.000Z',
        stale: '2026-08-25T00:05:00.000Z',
        center: [0, 0],
    },
    geometry: { type: 'Point', coordinates: [0, 0] },
};

test('outgoingMessages: legacy feature record without type', () => {
    const [message] = TaskBase.outgoingMessages(sqs([{ xml: '<event/>', geojson }]));
    assert.equal(message.type, OutgoingMessageType.Feature);
    if (message.type !== OutgoingMessageType.Feature) throw new Error('unreachable');
    assert.equal(message.xml, '<event/>');
    assert.equal(message.geojson.id, 'test-uid');
});

test('outgoingMessages: event & device records', () => {
    const messages = TaskBase.outgoingMessages(sqs([{
        type: 'event', action: 'update', channels: [3, 7], data: { id: 'uuid', name: 'Fire' },
    }, {
        type: 'device', action: 'delete', channels: [3], data: { id: 'uuid' },
    }]));

    assert.equal(messages.length, 2);
    assert.equal(messages[0].type, OutgoingMessageType.Event);
    if (messages[0].type !== OutgoingMessageType.Event) throw new Error('unreachable');
    assert.equal(messages[0].action, OutgoingAction.Update);
    assert.deepEqual(messages[0].channels, [3, 7]);
    assert.equal(messages[0].data.name, 'Fire');

    assert.equal(messages[1].type, OutgoingMessageType.Device);
    if (messages[1].type !== OutgoingMessageType.Device) throw new Error('unreachable');
    assert.equal(messages[1].action, OutgoingAction.Delete);
});

test('outgoingMessages: invalid record', () => {
    assert.throws(() => TaskBase.outgoingMessages(sqs([{ type: 'event', action: 'read', channels: [], data: {} }])));
    assert.throws(() => TaskBase.outgoingMessages(sqs([{ type: 'unknown' }])));
});
