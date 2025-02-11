import { Static, TSchema, TUnknown } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

export default class TypeValidator {
    /**
     * Arbitrary JSON objects occasionally need to get typed as part of an ETL
     * This function provides the ability to strictly type unknown objects at runtime
     */
    static type<T extends TSchema = TUnknown>(type: T, body: unknown, opts = {
        default: true,
        convert: true,
        clean: true,
    }): Static<T> {
        if (opts.default) {
            Value.Default(type, body)
        }

        if (opts.clean) {
            Value.Clean(type, body)
        }

        if (opts.convert) {
            Value.Convert(type, body)
        }

        const result = Value.Check(type, body)

        if (result) return body;

        const errors = Value.Errors(type, body);

        const firstError = errors.First();

        throw new Error(`Internal Validation Error: ${JSON.stringify(firstError)} -- Body: ${JSON.stringify(body)}`);
    }
}
