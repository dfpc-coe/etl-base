<h1 align=center>ETL Base</h1>

<p align=center>Helper library for building NodeJS based ETL Lambdas</p>

The [ETL Server](https://github.com/dfpc-coe/CloudTAK) is designed to manage and run
Lambda Container Images that perform various ETL functions to convert data into
formats that are more easily ingestible via TAK.

The ETL server can run runtimes of any language but helper functions are primarily
written in [NodeJS](https://nodejs.org/en). This library serves as both a usable
base for removing much of the boilerplate to interacting with the TAK ETL service,
as well as serving as a (hopefully) straightforward and readable example for how
services in other languages could be written

## Building & Pushing ETL Containers

This package exposes a `cloudtak-etl` script which builds the ETL Container Image
in the current directory and pushes it to the AWS ECR repository used by a CloudTAK
instance to run ETL Tasks.

The ETL repo must contain a `Dockerfile` as well as a `capabilities.json` document
(validated against the `StaticCapabilities` schema exported by this package) which
is embedded in the OCI Image Manifest as a `com.cloudtak.capabilities` annotation
and later read by the CloudTAK API directly from ECR.

Note that this static, build-time document is distinct from the live Capabilities
document (the `Capabilities` export of this package) which a deployed task returns
when invoked with a `capabilities` event: the static document describes a task
version before it is ever deployed, while the live document reflects the runtime
environment schemas of the running image.

```sh
export AWS_REGION='us-east-1'
export AWS_ACCOUNT_ID='123456789012'
export Environment='prod' # Optional - defaults to prod

npx cloudtak-etl
```

The image is tagged as `tak-vpc-<Environment>-cloudtak-tasks:<repo name>-v<package.json version>`

### Outgoing Types

A task that provides the `Outgoing` data flow declares the resource types it
accepts under `invocations.outgoing.types` in its `capabilities.json`. A type is
expressed as `<resource>:<action>` and must be one of the `OUTGOING_TYPES` exported
by this package (see `StaticCapabilities.isValidOutgoingType()` & `StaticCapabilities.isSubscribedOutgoingType()`) (`<resource>:*` covers every action):

| Resource       | Actions                      | Delivered as                                                          |
| -------------- | ---------------------------- | --------------------------------------------------------------------- |
| `feature`      | `*`                          | Streaming CoT Features from the Layer Connection                      |
| `event`        | `create`, `update`, `delete` | CoreEvents sharing a Channel with the Connection                      |
| `device`       | `create`, `update`, `delete` | CoreDevices sharing a Channel with the Connection                     |
| `board`        | `create`, `update`, `delete` | CoreEvent Boards of a Channel the Connection has active               |
| `board:column` | `create`, `update`, `delete` | Columns of those Boards                                               |
| `board:event`  | `create`, `update`, `delete` | CoreEvents placed on, moved between Columns of, or removed from those Boards |

The action is the segment after the last `:` and a wildcard only covers its own
resource - `board:*` does not deliver `board:column:*` or `board:event:*` messages.

When an Outgoing Layer is created in CloudTAK it subscribes to a subset of the
declared types (`layer.outgoing.subscriptions`) and only receives SQS records for
those. Records are parsed into a typed `OutgoingMessage` with `TaskBase.outgoingMessages()`:

```ts
async outgoing(event: Lambda.SQSEvent): Promise<boolean> {
    for (const message of Task.outgoingMessages(event)) {
        if (message.type === OutgoingMessageType.Feature) {
            // message.xml, message.geojson
        } else if (message.type === OutgoingMessageType.Event) {
            // message.action, message.channels, message.data
        }
    }

    return true;
}
```

## API

The ETL Base Class is designed to be extended by classes performing ETL functions.

The following is an example of as simple an ETL service as possible that shows
how this extension is performed.

```ts
import { Type } from '@sinclair/typebox';
import ETL, { TaskLayer, Event, SchemaType, handler as internal, local, DataFlowType, InvocationType } from '@tak-ps/etl';

export default class Task extends ETL {
    static name = 'etl-example';
    static flow = [ DataFlowType.Incoming, DataFlowType.Outgoing ];
    static invocation = [ InvocationType.Schedule ];

    schema(
        type: SchemaType = SchemaType.Input,
        flow: DataFlowType = DataFlowType.Incoming
    ): Promise<TSchema>
        if (flow === DataFlowType.Incoming && type === SchemaType.Input) {
            return Type.Object({
                password: Type.String({
                    description: 'The password for the service'
                })
            });
        } else if (flow === DataFlowType.Outgoing && type === SchemaType.Input) {
            return Type.Object({
                callSign: Type.String({
                    description: 'The CallSign of the returned point'
                })
            });
        } else {
            return Type.Object({});
        }
    }

    async control(): Promise<void> {
        // Provided function to obtain all environment config as defined by a user in the UI
        const layer = await this.fetchLayer();

        // The Layer object contains all the properties as defined by the Get Layer API
        const environment = layer.environent;

        // Provided submit function to submit geospatial features to be converted to CoT
        // See format overview: https://github.com/tak-ps/node-cot#geojson-spec
        await this.submit({
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "properties": {
                    callsign: environment.CallSign
                },
                "geometry": {
                    "type": "Point",
                    "coordinates": [1.0, 2.0]
                }
            }]
        });

        // A FeatureCollection with a `schema` is posted to the Connection submit API
        // where CloudTAK maps its Features by the Layer's Field Mapping for that schema
        // Features without a geometry are accepted here
        await this.submit({
            "type": "FeatureCollection",
            "schema": "device",
            "features": [{
                "id": "device-1",
                "type": "Feature",
                "properties": {
                    callsign: environment.CallSign
                }
            }]
        });
    }
}

// Optionally allow CLI calls
await local(new Task(), import.meta.url);
export async function handler(event: Event = {}, context?: unknown) {
    return await internal(new Task(), event, context);
}
```

### API

The API documentation is generated automatically by any commit to the `main` branch.

Documentation for the API can be found at [dfpc-coe.github.io/etl-base](https://dfpc-coe.github.io/etl-base/)

