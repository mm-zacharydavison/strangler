export type AsyncFunction = (...args: unknown[]) => Promise<unknown>
export type AsyncService = {
  // biome-ignore lint/suspicious/noExplicitAny: TODO: Make these types stricter.
  [K in keyof any]: K extends string ? AsyncFunction | any : any
}

/**
 * A callback to be executed during any '-compare' modes.
 *
 * You can use this to log any differences, for example.
 */
export type OnComparison = (comparison: {
  /**
   * The 'old' (2nd position) implementations result.
   *
   * Can be either a value or an error, if an error was thrown.
   */
  oldResult: unknown
  /**
   * The 'new' (1st position) implementations result.
   *
   * Can be either a value or an error, if an error was thrown.
   */
  newResult: unknown
  /**
   * 'old' duration in milliseconds.
   */
  oldDuration: number
  /**
   * 'new' duration in milliseconds.
   */
  newDuration: number
  /**
   * The name of the method that was invoked.
   */
  methodName: string
  /**
   * The arguments that were passed to the function.
   */
  parameters: unknown[]
}) => void

/**
 * A runtime 'feature flag' for changing the strangler mode.
 *
 * @remarks
 * This is `string`, not `StranglerMode`, to make typing at the call-site easier, and because usually FeatureFlags will return `string`.
 *
 * We error check the value to make sure it is a valid `StranglerMode`.
 */
export type FeatureFlag = () => Promise<string>

/**
 * The different possible modes available.
 * - 'new': Use the 'new' implementation -> `Strangler('flag-name', this-one, null)`
 * - 'old': Use the 'old' implementation -> `Strangler('flag-name', null, this-one)`
 * - 'new-compare': Use the 'new' implementation, but run the 'old' in parallel and compare them.
 * - 'old-compare': Use the 'old' implementation, but run the 'new' in parallel and compare them.
 */
export type StranglerMode = 'old' | 'new' | 'old-compare' | 'new-compare'

/**
 * Configuration for Strangler.
 */
export interface StranglerConfig {
  /**
   * If the difference in runtime of a method is longer than this, the comparison callback will be called.
   *
   * Value is in milliseconds.
   *
   * @default 300ms
   */
  acceptableDurationDifference?: number
  /**
   * Logger object with methods for different logging levels.
   *
   * @default console
   */
  logger?: Partial<typeof console>
  /**
   * The equality function to use to test if results are identical.
   *
   * @default `JSON.stringify(a) === JSON.stringify(b)`
   * @returns `true` if the values are equal, false otherwise.
   */
  equalityFn?: (a: unknown, b: unknown, parameters?: unknown) => boolean

  /**
   * If true, will wait for the comparison to complete before returning the result.
   * By default, the result is returned immediately after the primary promise completes in order to avoid impacting latency
   *
   * @default false
   */
  waitForComparison?: boolean
}

const defaultConfig: Required<StranglerConfig> = {
  acceptableDurationDifference: 300,
  logger: console,
  equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  waitForComparison: false,
}

/**
 * A utility type for creating an interface from an existing class.
 *
 * You can use this with Strangler like so:
 *
 * ```ts
 * class OriginalService {
 *  function doSomething(withArguments: DoSomethingArguments)
 * }
 *
 * class NewService implements I<OriginalService> {
 *  function doSomething(withArguments: DoSomethingArguments)
 * }
 * ```
 */
export type I<T> = {
  [K in keyof T]: T[K]
}

/**
 * An error that is thrown while executing a Strangled operation.
 *
 * e.g. the 'new' or 'old' method will throw this.
 *
 * It's only used internally by Strangler.
 */
export class ExecutionError extends Error {
  constructor(
    /// The error that was thrown causing this execution to fail.
    public readonly cause: unknown,
    /// The duration in milliseconds of the execution.
    public readonly duration: number,
  ) {
    super(cause instanceof Error ? cause.message : String(cause))
  }
}

/**
 * Wrap two implementations and put them behind a feature flag allowing you to control which is used at runtime.
 *
 * See README.md for full documentations.
 *
 * @param featureFlag - The callback that is called to provide the current 'mode'.
 * @param newImplementation - The 'new' implementation. This can be a partial implementation.
 * @param oldImplementation - The 'old' implementation.
 * @param onComparison - Called if results differ, or if the performance difference exceeds `config.acceptableDurationDifference`.
 * @param config - Optional configuration, see `StranglerConfig`.
 * @returns A proxy object that you can use in place of your original implementations.
 */
export function Strangler<T extends AsyncService, K extends keyof T>(
  featureFlag: FeatureFlag,
  newImplementation: { [P in K]: T[P] },
  oldImplementation: T,
  onComparison?: OnComparison,
  config?: StranglerConfig,
): T {
  const fullConfig = {
    ...defaultConfig,
    ...config,
  }

  const isValidMode = (mode: string): mode is StranglerMode =>
    ['old', 'new', 'old-compare', 'new-compare'].includes(mode)

  return new Proxy(oldImplementation, {
    get(target, prop: string) {
      const method = target[prop]

      if (typeof method === 'function') {
        return async (...args: unknown[]) => {
          const mode = await featureFlag()
          const hasNewImplementation = prop in newImplementation && typeof (newImplementation as any)[prop] === 'function'
          const isCompareMode = mode === 'new-compare' || mode === 'old-compare'

          if (!isValidMode(mode)) {
            fullConfig.logger.error?.(new Error(`Invalid StranglerMode: ${mode}`))
            // Fallback to 'old' implementation.
            return (oldImplementation[prop] as AsyncFunction).apply(oldImplementation, args)
          }

          // Compare mode.
          if (hasNewImplementation && isCompareMode) {
            const executeMethod = async (impl: AsyncService) => {
              const start = performance.now()
              try {
                const result = await (impl[prop] as AsyncFunction).apply(impl, args)
                return {
                  result,
                  duration: performance.now() - start,
                }
              } catch (error) {
                throw new ExecutionError(error, performance.now() - start)
              }
            }

            // Start both implementations running in parallel
            const oldPromise = executeMethod(oldImplementation)
            const newPromise = executeMethod(newImplementation)

            // Determine which promise to wait for based on the mode
            const [primaryPromise, secondaryPromise] =
              mode === 'new-compare' ? [newPromise, oldPromise] : [oldPromise, newPromise]

            // Wait only for the primary promise to complete
            const primaryResult = await primaryPromise

            // After getting the primary result, wait for the secondary promise to complete in the background
            // and call onComparison when both are done
            if (onComparison) {
              secondaryPromise
                .catch((error) => error)
                .then((secondaryResult) => {
                  const [oldResult, newResult] =
                    mode === 'new-compare'
                      ? [secondaryResult, primaryResult]
                      : [primaryResult, secondaryResult]

                  const oldDuration = oldResult.duration
                  const newDuration = newResult.duration

                  const oldValue =
                    oldResult instanceof ExecutionError ? oldResult.cause : oldResult.result
                  const newValue =
                    newResult instanceof ExecutionError ? newResult.cause : newResult.result

                  try {
                    const durationDifference = newDuration - oldDuration
                    const areEqual = fullConfig.equalityFn(oldValue, newValue, args)

                    if (!areEqual || durationDifference > fullConfig.acceptableDurationDifference) {
                      onComparison({
                        oldResult: oldValue,
                        newResult: newValue,
                        oldDuration: oldDuration,
                        newDuration: newDuration,
                        methodName: prop,
                        parameters: args,
                      })
                    }
                  } catch (error) {
                    fullConfig.logger.error?.(
                      '[Strangler] Equality or comparison functions failed',
                      { error },
                    )
                  }
                })

              // If waitForComparison is true, wait for the secondary promise to complete before returning the result
              if (fullConfig.waitForComparison) {
                await secondaryPromise.catch((error) => error)
              }
            }

            // Return the result from the primary implementation
            return primaryResult.result
          }

          // Normal mode.
          const useNew = mode === 'new' && hasNewImplementation
          const targetMethod = useNew
            ? (newImplementation[prop as K] as AsyncFunction).bind(newImplementation)
            : (oldImplementation[prop as K] as AsyncFunction).bind(oldImplementation)
          return targetMethod(...args)
        }
      }

      return method
    },
  })
}
