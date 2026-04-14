import TypeValidator from './type.js';
import type { TypeOpts } from './type.js';
import type { Static, TSchema, TUnknown } from "@sinclair/typebox";

export class TypedResponse extends Response {
    constructor(response: Response) {
        super(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
        });
    }

    typed<T extends TSchema>(type: T, opts?: TypeOpts): Promise<Static<T>>;

    async typed<T extends TSchema = TUnknown>(type: T, opts?: TypeOpts): Promise<Static<T>> {
        const body = await this.json();
        return TypeValidator.type(type, body, opts);
    }
}

export default async function(
    input: string | URL,
    init?: RequestInit
): Promise<TypedResponse> {
    return new TypedResponse(await fetch(input, init));
}
