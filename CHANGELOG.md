# CHANGELOG

## Emoji Cheatsheet
- :pencil2: doc updates
- :bug: when fixing a bug
- :rocket: when making general improvements
- :white_check_mark: when adding tests
- :arrow_up: when upgrading dependencies
- :tada: when adding new features

## Version History

### v6.3.0

- :rocket: Ensure static `name` value matches remote layer
- :rocket: Automatically apply `end` if a current path is supplied
- :arrow_up: Update Core Deps

### v6.2.0

- :arrow_up: Update Core Deps
- :rocket: Export `InputFeature` directly

### v6.1.0

- :rocket: Fix node-cot peer dep

### v6.0.1

- :bug: Fix array type of InputFeatureCollection

### v6.0.0

- :rocket: Change `submit(FeatureCollection)` to `submit(InputFeatureCollection)`

### v5.2.1

- :rocket: Additional Use ` ofexport type` syntax

### v5.2.0

- :rocket: Use `export type` syntax
- :arrow_up: Update all core deps
- :arrow_up: Update `node-cot@12`

### v5.1.1

- :bug: Fix ephemeral API URL

### v5.1.0

- :tada: Expose Ephemeral key/value API
- :rocket: Use strongly typed Layer Responses
- :arrow_up: Update to latest deps

### v5.0.0

- :rocket: Apply default values if present in `Environment`

### v4.12.0

- :rocket: Pass `fetch` error messages upstream
- :arrow_up: Update all core deps

### v4.11.1

- :rocket: Update Feature

### v4.11.0

- :rocket: Export node-cot `Feature`

### v4.10.2

- :bug: Remove extraneous `await`

### v4.10.1

- :bug: Maintain previous exports

### v4.10.0

- :rocket: Add `Task.env()` function to return validated environment

### v4.9.0

- :rocket: Log Response body if it fails Type Checks

### v4.8.0

- :rocket: Add basic support for JSON Schema String Formats

### v4.7.2

- :bug: Avoid clashing with default fetch use used in index

### v4.7.1

- :rocket: Avoid use of express dependency

### v4.7.0

- :rocket: Expose TypedFetch Interface

### v4.6.0

- :rocket: Update Alert API

### v4.5.0

- :rocket: Hit the API with empty feature collections

### v4.4.0

- :rocket: Update to flat ESLint Config

### v4.3.6

- :bug: Fix DataSync UIDs Gen

### v4.3.5

- :bug: Fix timezone override

### v4.3.4

- :bug: Ensure `schema.properties` is present

### v4.3.3

- :bug: Check for length of timezone

### v4.3.2

- :bug: Additional field checks

### v4.3.1

- :bug: Ignore `No TimeZone` option in config

### v4.3.0

- :rocket: Move `env` to it's own fn to allow env to be pop'd before constructor called

### v4.2.2

- :rocket: Squash instanceof bugs

### v4.2.1

- :rocket: Schema as instance method

### v4.2.0

- :bug: Fix use of this

### v4.1.2

- :arrow_up: Change to deps

### v4.1.1

- :arrow_up: Include minimist types

### v4.1.0

- :tada: Include automatic basic CLI
- :rocket: Allow `schema:output` or `schema:input` for CLI
- :rocket: Automatically parse `.env` if current path is given to `.local(path: string)`

### v4.0.0

- :rocket: `layer() => fetchLayer`
- :rocket: `layer` now stores the output of `fetchLayer` to support internal operations that require it
- :tada: The new Config option is now supported - initially with `timezone` override support

### v3.0.1

- :bug: Add `internal: true`

### v3.0.0

- :rocket: Use new token strategy

### v2.1.0

- :tada: Add generic fetch method

### v2.0.2

- :bug: Fix existance check not being thrown

### v2.0.1

- :bug: Misunderstood Object type -> `JSONSchema6`

### v2.0.0

- :rocket: Schema now returns a `JSONSchema6Object` Type

### v1.4.3

- :arrow_up: Update Base Deps

### v1.4.2

- :arrow_up: Update Base Deps

### v1.4.1

- :bug: Fix how larger submissions are split up and submitted

### v1.4.0

- :rocket: The ETL CoT submission endpoint has a limit of 50mb per submission. To make for a better developer experience, automatically submit in smaller batches

### v1.3.2

- :bug: Include ContentType header for alerts

### v1.3.1

- :bug: small typescript definition fixes

### v1.3.0

- :rocket: Add support for creating Alerts

### v1.2.1

- :tada: Include Event type

### v1.2.0

- :tada: Include static type for layer response

### v1.1.2

- :arrow_up: Update base deps

### v1.1.1

- :arrow_up: Update base deps

### v1.1.0

- :arrow_up: Update base deps
- :rocket: Additional logging

### v1.0.2

- :bug: Return layer as JSON, throwing if the request fails
- :rocket: If doing local dev, automatically create ETL Token

### v1.0.1

- :bug: Add TypeScript build step to release workflow

### v1.0.0

- :rocket: Initial Release
