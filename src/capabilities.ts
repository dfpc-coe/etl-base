import fs from 'node:fs/promises';
import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import Err from '@openaddresses/batch-error';

/**
 * OCI Image Manifest annotation under which a task's Capabilities document is
 * embedded at build time and later retrieved from ECR
 */
export const CAPABILITIES_ANNOTATION = 'com.cloudtak.capabilities';

/**
 * Known CloudTAK permissions and the levels at which they can be granted.
 *
 * A permission is expressed as `<permission>:<level>` - ie `video:read` - where
 * `<permission>:*` grants every level of the permission
 */
export const PERMISSIONS: Record<string, Array<string>> = {
    feature: ['submit'],
    video: ['create', 'read', 'update', 'delete'],
    injector: ['create', 'read', 'update', 'delete']
};

/**
 * Ensure a `<permission>:<level>` string refers to a known permission and a
 * level it can be granted at - `<permission>:*` is valid for every permission
 */
export function isValidPermission(resource: string): boolean {
    const separator = resource.indexOf(':');
    if (separator === -1) return false;

    const permission = resource.slice(0, separator);
    const level = resource.slice(separator + 1);

    const levels = PERMISSIONS[permission];
    if (!levels) return false;

    return level === '*' || levels.includes(level);
}

export const CapabilitiesPermissionSchema = Type.Object({
    resource: Type.String({
        description: 'The resource the permission applies to - ie feature:*',
    }),
    required: Type.Boolean({
        description: 'Whether the task can function without this permission',
    }),
    description: Type.String({
        description: 'Human readable explanation of why the task needs this permission',
    }),
});

export const CapabilitiesScheduleInvocationSchema = Type.Object({
    description: Type.String(),
    default: Type.Object({
        enabled: Type.Boolean(),
        schedule: Type.String({
            description: 'AWS Schedule Expression - ie rate(1 minute)',
        }),
    }),
});

export const CapabilitiesWebhookInvocationSchema = Type.Object({
    description: Type.String(),
    default: Type.Object({
        enabled: Type.Boolean(),
    }),
});

export const CapabilitiesOutgoingTypeSchema = Type.Object({
    resource: Type.String({
        description: 'The resource type the task accepts - ie feature:*',
    }),
    description: Type.String(),
});

export const StaticCapabilitiesSchema = Type.Object({
    version: Type.String({
        description: 'Version of the Capabilities document format',
    }),
    name: Type.String({
        description: 'Human readable name of the task',
    }),
    description: Type.String({
        description: 'Human readable description of what the task does',
    }),
    permissions: Type.Array(CapabilitiesPermissionSchema),
    compute: Type.Object({
        memory: Type.Integer({
            description: 'Memory in MB the task should be allocated',
        }),
        timeout: Type.Integer({
            description: 'Timeout in seconds after which the task is terminated',
        }),
    }),
    invocations: Type.Object({
        incoming: Type.Optional(Type.Object({
            schedule: Type.Optional(CapabilitiesScheduleInvocationSchema),
            webhook: Type.Optional(CapabilitiesWebhookInvocationSchema),
        })),
        outgoing: Type.Optional(Type.Object({
            types: Type.Array(CapabilitiesOutgoingTypeSchema),
        })),
    }),
});

export type StaticCapabilitiesDocument = Static<typeof StaticCapabilitiesSchema>;

/**
 * The static Capabilities document authored alongside an ETL task's source code
 * as a capabilities.json and embedded in the OCI Image Manifest at build time.
 * It describes the task, the permissions it needs, and the invocation modes it
 * supports before the task is ever deployed
 *
 * Note this format intentionally differs from the live Capabilities document
 * returned by invoking a deployed task Lambda (the Capabilities export of this
 * package), which reflects the runtime environment schemas of the running image
 *
 * @class
 */
export default class StaticCapabilities {
    static schema = StaticCapabilitiesSchema;
    static annotation = CAPABILITIES_ANNOTATION;

    /**
     * Read and validate a capabilities.json document from disk, returning null
     * if no document exists at the given path
     */
    static async read(path: string | URL): Promise<StaticCapabilitiesDocument | null> {
        let contents: string;

        try {
            contents = String(await fs.readFile(path));
        } catch (err) {
            if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return null;
            throw err;
        }

        let doc: unknown;
        try {
            doc = JSON.parse(contents);
        } catch (err) {
            throw new Err(400, err instanceof Error ? err : new Error(String(err)), `Invalid JSON in Capabilities Document: ${path}`);
        }

        return StaticCapabilities.validate(doc);
    }

    static is(input: unknown): input is StaticCapabilitiesDocument {
        return Value.Check(StaticCapabilitiesSchema, input)
            && input.permissions.every((permission) => isValidPermission(permission.resource));
    }

    static validate(input: unknown): StaticCapabilitiesDocument {
        if (!Value.Check(StaticCapabilitiesSchema, input)) {
            const errors = [];
            for (const error of Value.Errors(StaticCapabilitiesSchema, input)) {
                errors.push(`${error.path}: ${error.message}`);
            }

            throw new Err(400, null, `Invalid Capabilities Document: ${errors.join(', ')}`);
        }

        const invalid = input.permissions
            .map((permission) => permission.resource)
            .filter((resource) => !isValidPermission(resource));

        if (invalid.length) {
            throw new Err(400, null, `Invalid Capabilities Document: Unknown Permissions: ${invalid.join(', ')}`);
        }

        return input;
    }
}
