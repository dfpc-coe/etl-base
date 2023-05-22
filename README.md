<h1 align=center>ETL Base</h1>

<p align=center>Helper library for building NodeJS based ETL Lambdas</p>

The [ETL Server](https://github.com/tak-ps/etl) is designed to manage and run
Lambda Container Images that perform various ETL functions to convert data into
formats that are more easily ingestible via TAK.

The ETL server can run runtimes of any language but helper functions are primarily
written in [NodeJS](https://nodejs.org/en). This library serves as both a usable
base for removing much of the boilerplate to interacting with the TAK ETL service,
as well as serving as a (hopefully) straightforward and readable example for how
services in other languages could be written

## API

The ETL Base Class is designed to be extended by classes performing ETL functions.

The following is an example of as simple an ETL service as possible that shows
how this extension is performed.

```ts
import ETL, { Event } from '@tak-ps/etl';

export default class Task extends ETL {
    // The UI is dynamically generated based on the JSON Schema that the Lambda provides in the schema method.

    static schema() {
        return {
            type: 'object',
            required: ['CallSign'],
            properties: {
                'CallSign': {
                    type: 'string',
                    description: 'The CallSign of the returned point'
                },
            }
        }
    }

    async control(): Promise<void> {
        // Provided function to obtain all environment config as defined by a user in the UI
        const layer = await this.layer();

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
    }
}
```
