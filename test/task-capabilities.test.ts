import test from 'node:test';
import assert from 'node:assert';
import { Type } from '@sinclair/typebox';
import type { TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import TaskBase, { SchemaType, DataFlowType, DEFAULT_SCHEMA_ID } from '../index.js';
import type { NamedSchema } from '../index.js';
import { Capabilities } from '../src/types.js';

process.env.ETL_API = 'http://127.0.0.1:5001';
process.env.ETL_LAYER = '1';
process.env.ETL_TOKEN = 'etl.test-token';

class SingleSchemaTask extends TaskBase {
    static flow = [DataFlowType.Incoming, DataFlowType.Outgoing];

    async schema(
        type: SchemaType = SchemaType.Input,
        flow: DataFlowType = DataFlowType.Incoming
    ): Promise<TSchema | Array<NamedSchema>> {
        if (flow === DataFlowType.Incoming && type === SchemaType.Output) {
            return Type.Object({ serial: Type.String() });
        }

        return Type.Object({});
    }
}

class NamedSchemaTask extends TaskBase {
    async schema(
        type: SchemaType = SchemaType.Input,
        flow: DataFlowType = DataFlowType.Incoming
    ): Promise<TSchema | Array<NamedSchema>> {
        if (flow === DataFlowType.Incoming && type === SchemaType.Output) {
            return [
                { id: 'telemetry', schema: Type.Object({ battery: Type.Number() }) },
                { id: 'alert', schema: Type.Object({ message: Type.String() }) },
            ];
        }

        return Type.Object({});
    }
}

class BrokenSchemaTask extends TaskBase {
    async schema(
        type: SchemaType = SchemaType.Input
    ): Promise<TSchema | Array<NamedSchema>> {
        if (type === SchemaType.Output) throw new Error('Upstream unavailable');

        return Type.Object({});
    }
}

test('namedSchemas: single schema is published as default', () => {
    const schema = Type.Object({ serial: Type.String() });

    assert.deepEqual(TaskBase.namedSchemas(schema), [{ id: DEFAULT_SCHEMA_ID, schema }]);
});

test('namedSchemas: named schemas pass through', () => {
    const named = [{ id: 'alert', schema: Type.Object({}) }];

    assert.equal(TaskBase.namedSchemas(named), named);
});

test('capabilities: default Output schema is wrapped as default', async () => {
    const capabilities = await new TaskBase().capabilities();

    assert.ok(Value.Check(Capabilities, capabilities), 'capabilities match the Capabilities schema');
    assert.equal(capabilities.outgoing, undefined);
    assert.deepEqual(capabilities.incoming!.schema.output, [{
        id: DEFAULT_SCHEMA_ID,
        schema: Type.Object({}),
    }]);
});

test('capabilities: single Output schemas are wrapped for both flows', async () => {
    const capabilities = await new SingleSchemaTask().capabilities();

    assert.ok(Value.Check(Capabilities, capabilities), 'capabilities match the Capabilities schema');
    assert.deepEqual(capabilities.incoming!.schema.output, [{
        id: DEFAULT_SCHEMA_ID,
        schema: Type.Object({ serial: Type.String() }),
    }]);
    assert.deepEqual(capabilities.outgoing!.schema.output, [{
        id: DEFAULT_SCHEMA_ID,
        schema: Type.Object({}),
    }]);
});

test('capabilities: named Output schemas pass through', async () => {
    const capabilities = await new NamedSchemaTask().capabilities();

    assert.ok(Value.Check(Capabilities, capabilities), 'capabilities match the Capabilities schema');
    assert.deepEqual(capabilities.incoming!.schema.output.map((s) => s.id), ['telemetry', 'alert']);
});

test('capabilities: Output schema errors leave an empty array', async () => {
    const capabilities = await new BrokenSchemaTask().capabilities();

    assert.ok(Value.Check(Capabilities, capabilities), 'capabilities match the Capabilities schema');
    assert.deepEqual(capabilities.incoming!.schema.output, []);
    assert.deepEqual(capabilities.incoming!.schema.outputError, {
        status: 400,
        message: 'Upstream unavailable',
    });
});
