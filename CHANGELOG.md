# CHANGELOG

## Emoji Cheatsheet
- :pencil2: doc updates
- :bug: when fixing a bug
- :rocket: when making general improvements
- :white_check_mark: when adding tests
- :arrow_up: when upgrading dependencies
- :tada: when adding new features

## Version History

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
