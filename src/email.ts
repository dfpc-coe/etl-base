import PostalMime from 'postal-mime';
import type { Address } from 'postal-mime';
import S3 from '@aws-sdk/client-s3';
import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';

/**
 * The event an Incoming Layer is invoked with when CloudTAK receives an email
 * addressed to it - the raw MIME message is stored in S3 at `bucket`/`key`
 * while `mail` & `receipt` carry the headers and verdicts reported by AWS SES
 */
export const EmailEvent = Type.Object({
    type: Type.Literal('email'),
    bucket: Type.String({ minLength: 1 }),
    key: Type.String({ minLength: 1 }),
    mail: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    receipt: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export interface EmailAddress {
    name: string;
    address: string;
}

export interface EmailAttachment {
    filename: string | null;
    mimeType: string;
    disposition: string | null;
    contentId: string | null;
    content: Buffer;
}

export interface EmailMessage {
    /** ID assigned to the message by AWS SES or the path of a local file */
    id: string;
    from: EmailAddress | null;
    to: Array<EmailAddress>;
    cc: Array<EmailAddress>;
    subject: string;
    /** ISO 8601 sending time or the raw header value if it could not be parsed */
    date: string | null;
    text: string | null;
    html: string | null;
    /** Every header of the message in document order with lowercase keys */
    headers: Array<{ key: string; value: string }>;
    attachments: Array<EmailAttachment>;
    raw: Buffer;
    /** Headers & verdicts reported by AWS SES - absent for local messages */
    ses?: {
        mail?: Record<string, unknown>;
        receipt?: Record<string, unknown>;
    };
}

function mailboxes(addresses?: Array<Address>): Array<EmailAddress> {
    const flat: Array<EmailAddress> = [];

    for (const address of addresses || []) {
        for (const mailbox of address.group || [address]) {
            if (mailbox.address) flat.push({ name: mailbox.name, address: mailbox.address });
        }
    }

    return flat;
}

export default class Email {
    static async parse(raw: Uint8Array | string, id: string = ''): Promise<EmailMessage> {
        const buffer = Buffer.from(raw);
        const parsed = await PostalMime.parse(buffer);

        return {
            id,
            from: mailboxes(parsed.from ? [parsed.from] : [])[0] || null,
            to: mailboxes(parsed.to),
            cc: mailboxes(parsed.cc),
            subject: parsed.subject || '',
            date: parsed.date || null,
            text: parsed.text ?? null,
            html: parsed.html ?? null,
            headers: parsed.headers.map((header) => ({ key: header.key, value: header.value })),
            attachments: parsed.attachments.map((attachment) => ({
                filename: attachment.filename,
                mimeType: attachment.mimeType,
                disposition: attachment.disposition,
                contentId: attachment.contentId || null,
                content: typeof attachment.content === 'string'
                    ? Buffer.from(attachment.content, attachment.encoding === 'base64' ? 'base64' : 'utf8')
                    : Buffer.from(attachment.content as Uint8Array),
            })),
            raw: buffer,
        };
    }

    static async fetch(event: Static<typeof EmailEvent>): Promise<EmailMessage> {
        const s3 = new S3.S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

        const res = await s3.send(new S3.GetObjectCommand({
            Bucket: event.bucket,
            Key: event.key,
        }));

        if (!res.Body) throw new Error(`Email ${event.key} is empty`);

        const message = await Email.parse(await res.Body.transformToByteArray(), event.key);

        message.ses = {
            mail: event.mail,
            receipt: event.receipt,
        };

        return message;
    }
}
