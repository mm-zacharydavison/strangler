## 🎋 Strangler

Strangler is a library that helps you build a new API by gradually migrating from an old one.

It provides you a few features:

- Swapping out a service implementation at runtime using feature flags.
- Swapping out only individual methods.
- Falling back to old implementation if the new one is not implemented yet.
- ⭐ Optionally running both implementations at the same time and logging any differences in return value, or duration.

Fundamentally, it allows you to do this:

```ts
@Module({
  providers: [
    {
      provide: EmailService,
      useFactory: (featureFlagsRepository: FeatureFlagsRepository) =>
        Strangler(
          () => featureFlagsRepository.getStringValue('email.use-v2'),
          new EmailServiceV2(), // new version
          new EmailService(),
          logStranglerComparison('EmailService')
        ),
    },
  ],
  imports: [],
  exports: [],
})
export class EmailModule {}
```

Overriding individual methods is also supported.
Any methods that are not implemented in the NEW service will be called in the OLD service.

```ts
  useFactory: (config: ConfigService, featureFlagsRepository: FeatureFlagsRepository) => {
    const oldEmailService = new EmailService(config)
    const newEmailService = new EmailServiceV2(config)
    return Strangler(
      () => featureFlagsRepository.getStringValue('emails.use-v2'),
      {
        // sendEmail is not implemented in the new service, and will fall back to the old implementation.
        sendPromotionalEmail: newEmailService.sendPromotionalEmail,
      }, 
      oldEmailService
    )
  } 
```

While I wrote Strangler with NestJS in mind, there is no dependency on NestJS and you can use it bare for any object you'd like.

```ts
const emailSender = Strangler(
 () => featureFlags.get('emails.use-v2'),
 new SelfHostedEmailService(),
 new SendgridEmailService(),
 logStranglerComparison('EmailService')
)
```

### OnComparison

Strangler accepts an `OnComparison` function that allows you to handle comparison events yourself however you wish (e.g. updating metrics, logging, etc).

For most cases though, you probably just want to log. `logStranglerComparison` is included for you to do that easily.

## Configuration

Strangler accepts an optional configuration object that allows you to customize its behavior:

```ts
interface StranglerConfig {
  /**
   * If the difference in runtime of a method is longer than this, the comparison callback will be called.
   * Value is in milliseconds. Default: 300ms
   */
  acceptableDurationDifference?: number;
  
  /**
   * Logger object with methods for different logging levels.
   * Default: console
   */
  logger?: Partial<typeof console>;
  
  /**
   * The equality function to use to test if results are identical.
   * Default: JSON.stringify(a) === JSON.stringify(b)
   */
  equalityFn?: (a: unknown, b: unknown, parameters?: unknown) => boolean;
  
  /**
   * If true, will wait for the comparison to complete before returning the result.
   * By default, the result is returned immediately after the primary promise completes.
   * Default: false
   */
  waitForComparison?: boolean;
}
```

### Equality Comparison

By default, Strangler uses `JSON.stringify` to compare results between old and new implementations. You can customize this behavior by providing your own `equalityFn` in the configuration. This is particularly useful when:

- Your objects contain circular references
- You need to ignore certain fields in the comparison
- You want to implement custom comparison logic

### Error Handling

When an error occurs during execution of either implementation, Strangler wraps it in an `ExecutionError` that includes:
- The original error (`cause`)
- The duration of the execution attempt (`duration`)

This allows you to track both the error and performance impact of failed executions.

### Comparison Modes

Strangler supports four different modes:

1. `'new'`: Use only the new implementation
2. `'old'`: Use only the old implementation
3. `'new-compare'`: Use new implementation but run old in parallel for comparison
4. `'old-compare'`: Use old implementation but run new in parallel for comparison

The comparison modes will trigger the `OnComparison` callback when:
- The results differ between implementations
- The execution time difference exceeds `acceptableDurationDifference`

## Limitations

Because calling the feature flag is an async operation, only proxying async methods is supported.
In future, we could support sync methods if a sync feature flag provider was added.

## 🚨 Risks

You **must** be aware that when using `-compare` modes, your application will run both implementations at the same time.

This means that if your calls have side-effects, or are not idempotent, you could see unexpected results.

We strongly recommend only using `Strangler` for APIs that are idempotent, and have **no** side-effects, such as GET requests that can be executed many times without issue.

## Installation

```bash
pnpm install @zdavison/strangler
```

## Test

```bash
# unit tests
pnpm test
```

# Contributors

`Strangler` was developed at [MeetsMore](http://meetsmore.com/) and then open sourced.
@GuillaumeDecMeetsMore contributed multiple features.
