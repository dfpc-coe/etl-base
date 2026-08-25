import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Err from '@openaddresses/batch-error';
import StaticCapabilities, {
    CAPABILITIES_ANNOTATION,
    PERMISSIONS,
    OUTGOING_TYPES,
    StaticCapabilitiesSchema,
} from '../src/capabilities.js';
import type { StaticCapabilitiesDocument } from '../src/capabilities.js';

function doc(): StaticCapabilitiesDocument {
    return {
        version: '1.0.0',
        name: 'Test Task',
        description: 'A task for testing the Capabilities document',
        permissions: [{
            resource: 'feature:submit',
            required: true,
            description: 'Submit CoT Features to CloudTAK',
        }, {
            resource: 'video:*',
            required: false,
            description: 'Manage Video Leases',
        }],
        compute: {
            memory: 256,
            timeout: 120,
        },
        invocations: {
            incoming: {
                schedule: {
                    description: 'Poll the upstream API',
                    default: {
                        enabled: true,
                        schedule: 'rate(1 minute)',
                    },
                },
                webhook: {
                    description: 'Accept upstream webhooks',
                    default: {
                        enabled: false,
                    },
                },
            },
            outgoing: {
                types: [{
                    resource: 'feature:*',
                    description: 'CoT Features',
                }],
            },
        },
    };
}

test('CAPABILITIES_ANNOTATION', () => {
    assert.equal(CAPABILITIES_ANNOTATION, 'com.cloudtak.capabilities');
    assert.equal(StaticCapabilities.annotation, CAPABILITIES_ANNOTATION);
});

test('StaticCapabilities.schema', () => {
    assert.equal(StaticCapabilities.schema, StaticCapabilitiesSchema);
});

test('PERMISSIONS', () => {
    assert.deepEqual(PERMISSIONS, {
        feature: ['submit'],
        video: ['create', 'read', 'update', 'delete'],
        injector: ['create', 'read', 'update', 'delete'],
        event: ['create', 'read', 'update', 'delete'],
        device: ['create', 'read', 'update', 'delete'],
    });
});

test('isValidPermission: known permission & level', () => {
    for (const permission of Object.keys(PERMISSIONS)) {
        for (const level of PERMISSIONS[permission]) {
            assert.equal(StaticCapabilities.isValidPermission(`${permission}:${level}`), true, `${permission}:${level}`);
        }
    }
});

test('isValidPermission: wildcard level', () => {
    for (const permission of Object.keys(PERMISSIONS)) {
        assert.equal(StaticCapabilities.isValidPermission(`${permission}:*`), true, `${permission}:*`);
    }
});

test('isValidPermission: no separator', () => {
    assert.equal(StaticCapabilities.isValidPermission('feature'), false);
    assert.equal(StaticCapabilities.isValidPermission(''), false);
});

test('isValidPermission: unknown permission', () => {
    assert.equal(StaticCapabilities.isValidPermission('unknown:read'), false);
    assert.equal(StaticCapabilities.isValidPermission('unknown:*'), false);
    assert.equal(StaticCapabilities.isValidPermission(':submit'), false);
});

test('isValidPermission: unknown level', () => {
    assert.equal(StaticCapabilities.isValidPermission('feature:read'), false);
    assert.equal(StaticCapabilities.isValidPermission('video:'), false);
    assert.equal(StaticCapabilities.isValidPermission('video:read:extra'), false);
});

test('is: valid document', () => {
    assert.equal(StaticCapabilities.is(doc()), true);
});

test('is: schema mismatch', () => {
    assert.equal(StaticCapabilities.is(null), false);
    assert.equal(StaticCapabilities.is('capabilities'), false);
    assert.equal(StaticCapabilities.is({}), false);

    const missing = doc() as Record<string, unknown>;
    delete missing.compute;
    assert.equal(StaticCapabilities.is(missing), false);
});

test('is: unknown permission', () => {
    const input = doc();
    input.permissions[0].resource = 'feature:read';

    assert.equal(StaticCapabilities.is(input), false);
});

test('validate: valid document', () => {
    const input = doc();

    assert.equal(StaticCapabilities.validate(input), input);
});

test('validate: no permissions requested', () => {
    const input = doc();
    input.permissions = [];

    assert.equal(StaticCapabilities.validate(input), input);
});

test('validate: schema mismatch', () => {
    assert.throws(() => {
        StaticCapabilities.validate({ version: '1.0.0' });
    }, (err: unknown) => {
        assert.ok(err instanceof Err);
        assert.equal(err.status, 400);
        assert.match(err.message, /^Invalid Capabilities Document: /);
        assert.match(err.message, /name/);
        return true;
    });
});

test('validate: unknown permissions', () => {
    const input = doc();
    input.permissions[0].resource = 'feature:read';
    input.permissions.push({
        resource: 'unknown:*',
        required: false,
        description: 'An unknown permission',
    });

    assert.throws(() => {
        StaticCapabilities.validate(input);
    }, (err: unknown) => {
        assert.ok(err instanceof Err);
        assert.equal(err.status, 400);
        assert.equal(err.message, 'Invalid Capabilities Document: Unknown Permissions: feature:read, unknown:*');
        return true;
    });
});

test('read', async (t) => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'etl-capabilities-'));

    t.after(async () => {
        await fs.rm(tmp, { recursive: true, force: true });
    });

    await t.test('missing file returns null', async () => {
        assert.equal(await StaticCapabilities.read(path.join(tmp, 'missing.json')), null);
    });

    await t.test('valid document', async () => {
        const capspath = path.join(tmp, 'capabilities.json');
        await fs.writeFile(capspath, JSON.stringify(doc()));

        assert.deepEqual(await StaticCapabilities.read(capspath), doc());
    });

    await t.test('invalid JSON', async () => {
        const capspath = path.join(tmp, 'invalid.json');
        await fs.writeFile(capspath, '{ not json');

        await assert.rejects(StaticCapabilities.read(capspath), (err: unknown) => {
            assert.ok(err instanceof Err);
            assert.equal(err.status, 400);
            // The safe message carries the path - the wrapped original carries the parse error
            assert.match(err.safe, /^Invalid JSON in Capabilities Document: /);
            return true;
        });
    });

    await t.test('invalid document', async () => {
        const capspath = path.join(tmp, 'unknown-permission.json');
        const input = doc();
        input.permissions[0].resource = 'feature:read';
        await fs.writeFile(capspath, JSON.stringify(input));

        await assert.rejects(StaticCapabilities.read(capspath), (err: unknown) => {
            assert.ok(err instanceof Err);
            assert.equal(err.status, 400);
            assert.equal(err.message, 'Invalid Capabilities Document: Unknown Permissions: feature:read');
            return true;
        });
    });

    await t.test('non-ENOENT filesystem errors are rethrown', async () => {
        await assert.rejects(StaticCapabilities.read(tmp), (err: unknown) => {
            assert.ok(err instanceof Error && 'code' in err && err.code === 'EISDIR');
            return true;
        });
    });
});

test('OUTGOING_TYPES', () => {
    assert.deepEqual(OUTGOING_TYPES, {
        feature: [],
        event: ['create', 'update', 'delete'],
        device: ['create', 'update', 'delete'],
    });
});

test('isValidOutgoingType', () => {
    for (const type of Object.keys(OUTGOING_TYPES)) {
        assert.equal(StaticCapabilities.isValidOutgoingType(`${type}:*`), true, `${type}:*`);
        for (const action of OUTGOING_TYPES[type]) {
            assert.equal(StaticCapabilities.isValidOutgoingType(`${type}:${action}`), true, `${type}:${action}`);
        }
    }

    assert.equal(StaticCapabilities.isValidOutgoingType('feature'), false);
    assert.equal(StaticCapabilities.isValidOutgoingType('feature:create'), false);
    assert.equal(StaticCapabilities.isValidOutgoingType('event:read'), false);
    assert.equal(StaticCapabilities.isValidOutgoingType('unknown:*'), false);
    assert.equal(StaticCapabilities.isValidOutgoingType(''), false);
});

test('matchesOutgoingType & isSubscribedOutgoingType', () => {
    assert.equal(StaticCapabilities.matchesOutgoingType('event:*', 'event:update'), true);
    assert.equal(StaticCapabilities.matchesOutgoingType('event:update', 'event:update'), true);
    assert.equal(StaticCapabilities.matchesOutgoingType('event:create', 'event:update'), false);
    assert.equal(StaticCapabilities.matchesOutgoingType('event:*', 'device:update'), false);
    assert.equal(StaticCapabilities.matchesOutgoingType('event', 'event:update'), false);

    assert.equal(StaticCapabilities.isSubscribedOutgoingType(['feature:*', 'event:update'], 'event:update'), true);
    assert.equal(StaticCapabilities.isSubscribedOutgoingType(['feature:*', 'event:update'], 'event:delete'), false);
    assert.equal(StaticCapabilities.isSubscribedOutgoingType([], 'feature:*'), false);
});

test('validate: unknown outgoing type', () => {
    const invalid = doc();
    invalid.invocations.outgoing = { types: [{ resource: 'event:read', description: 'Nope' }] };

    assert.equal(StaticCapabilities.is(invalid), false);
    assert.throws(() => StaticCapabilities.validate(invalid), (err: unknown) => {
        assert.ok(err instanceof Err);
        assert.equal(err.status, 400);
        assert.equal(err.message, 'Invalid Capabilities Document: Unknown Outgoing Types: event:read');
        return true;
    });
});
