import type { OnComparison } from '../strangler'

/**
 * A standard way to log differences when using @zdavison/strangler.
 * @param name - The name that identifies this, will be included in the log.
 * @param logger - The logger to use, anything with a .warn() function will work.
 * @returns - A Strangler.OnComparison function.
 */
export function logStranglerComparison(
  name: string,
  logger: { warn: (typeof console)['warn'] } = console,
): OnComparison {
  return (args) => {
    logger.warn(`[Strangler] 🔀 Difference in ${name}#${args.methodName} detected.`, {
      name,
      ...args,
    })
  }
}
