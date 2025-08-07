import { describe, it, expect, beforeEach } from 'vitest'
import {
  type AsyncFunction,
  type AsyncService,
  type FeatureFlag,
  Strangler,
  type StranglerMode,
} from './strangler'

// Mock logger that doesn't output anything
const mockLogger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  log: () => {},
  debug: () => {},
}

type TestService = AsyncService & {
  method1: (text?: string, value?: number) => Promise<string>
  method2: () => Promise<string>
  method3: () => Promise<string>
}

describe('Strangler', () => {
  describe('Basic Features', () => {
    // Not specifying the types allows us to also test type inference of `Strangler` arguments.
    const oldImpl = {
      method1: async () => 'old',
      method2: async () => 'old2',
      method3: async () => 'old3',
    }

    const newImpl = {
      method1: async () => 'new',
      method2: async () => 'new2',
    }

    it('WILL allow runtime toggling between two implementations', async () => {
      let flagValue: StranglerMode = 'old'
      const featureFlag = async () => flagValue
      const service = Strangler(featureFlag, newImpl, oldImpl)

      expect(await service.method1()).toBe('old')
      flagValue = 'new'
      expect(await service.method1()).toBe('new')
    })

    it('WILL allow toggling by individual method', async () => {
      const featureFlag: FeatureFlag = async () => 'new'
      const service = Strangler(
        featureFlag,
        {
          method1: oldImpl.method1,
          method2: newImpl.method2,
        },
        oldImpl,
      )

      expect(await service.method1()).toBe('old')
      expect(await service.method2()).toBe('new2')
    })

    it('Methods that are not implemented in the NEW service are called in the OLD service', async () => {
      const featureFlag: FeatureFlag = async () => 'new'
      const service = Strangler(featureFlag, newImpl, oldImpl)

      const result = await service.method3?.()
      expect(result).toBe('old3')
    })
  })

  describe('Basic Features (with classes)', () => {
    class OldImpl implements TestService {
      [key: string]: AsyncFunction | unknown
      instanceVariable = 'old'
      async method1() {
        return this.instanceVariable
      }
      async method2() {
        return 'old2'
      }
      async method3() {
        return 'old3'
      }
    }
    const oldImpl = new OldImpl()

    class NewImpl implements Partial<TestService> {
      [key: string]: AsyncFunction | unknown
      instanceVariable = 'new'
      async method1() {
        return this.instanceVariable
      }
      async method2() {
        return 'new2'
      }
    }
    const newImpl = new NewImpl()

    it('WILL allow runtime toggling between two implementations', async () => {
      let flagValue: StranglerMode = 'old'
      const featureFlag = async () => flagValue
      const service = Strangler(featureFlag, newImpl, oldImpl)

      expect(await service.method1()).toBe('old')
      flagValue = 'new'
      expect(await service.method1()).toBe('new')
    })

    it('WILL allow toggling by individual method', async () => {
      const featureFlag: FeatureFlag = async () => 'new'
      class NewImpl2 implements TestService {
        instanceVariable = 'old'
        async method1() {
          return this.instanceVariable
        }
        async method2() {
          return 'new2'
        }
        async method3() {
          return 'new3'
        }
      }
      const newImpl2 = new NewImpl2()
      const service = Strangler(featureFlag, newImpl2, oldImpl)

      expect(await service.method1()).toBe('old')
      expect(await service.method2()).toBe('new2')
    })

    it('Methods that are not implemented in the NEW service are called in the OLD service', async () => {
      const featureFlag: FeatureFlag = async () => 'new'
      const service = Strangler<TestService, keyof TestService>(featureFlag, newImpl, oldImpl)

      const result = await service.method3()
      expect(result).toBe('old3')
    })
  })
  describe('Comparison Features', () => {
    let oldImpl: Omit<TestService, 'method3'>
    let newImpl: Omit<TestService, 'method3'>
    let featureFlag: FeatureFlag

    beforeEach(() => {
      oldImpl = {
        method1: async () => 'old',
        method2: async () => 'old2',
      }
      newImpl = {
        method1: async () => 'new',
        method2: async () => 'new2',
      }
      featureFlag = async () => 'old'
    })

    it('WILL execute both implementations, and compare their return values', async () => {
      const comparisons: any[] = []
      featureFlag = async () => 'new-compare'

      // Create a promise that will resolve when onComparison is called
      let resolveComparisonPromise: () => void
      const comparisonPromise = new Promise<void>((resolve) => {
        resolveComparisonPromise = resolve
      })

      const service = Strangler(featureFlag, newImpl, oldImpl, (comparison) => {
        comparisons.push(comparison)
        resolveComparisonPromise()
      })

      const result = await service.method1()

      // Wait for the comparison to be completed
      await comparisonPromise

      expect(comparisons).toHaveLength(1)
      expect(comparisons[0]).toMatchObject({
        oldResult: 'old',
        newResult: 'new',
        methodName: 'method1',
      })
      expect(result).toBe('new')
    })

    it('WILL execute both implementations, and compare their performance', async () => {
      const slowNewImpl = {
        method1: async () => {
          await new Promise((resolve) => setTimeout(resolve, 50))
          return 'new'
        },
        method2: async () => 'method2',
        method3: async () => 'method3',
      }

      const comparisons: any[] = []
      featureFlag = async () => 'old-compare'

      // Create a promise that will resolve when onComparison is called
      let resolveComparisonPromise: () => void
      const comparisonPromise = new Promise<void>((resolve) => {
        resolveComparisonPromise = resolve
      })

      const service = Strangler(
        featureFlag,
        slowNewImpl,
        oldImpl,
        (comparison) => {
          comparisons.push(comparison)
          resolveComparisonPromise()
        },
        {
          acceptableDurationDifference: 0, // Always log.
        },
      )

      const result = await service.method1()

      // Wait for the comparison to be completed
      await comparisonPromise

      expect(comparisons).toHaveLength(1)
      expect(comparisons[0].newDuration).toBeGreaterThan(45)
      expect(comparisons[0].oldDuration).toBeLessThan(45)
      expect(result).toBe('old')
    })

    it('IF the values are not different, nothing is logged', async () => {
      const sameImpl = {
        method1: async () => 'same',
        method2: async () => 'method2',
        method3: async () => 'method3',
      }

      const comparisons: any[] = []
      featureFlag = async () => 'new-compare'
      const service = Strangler(featureFlag, sameImpl, sameImpl, (comparison) => {
        comparisons.push(comparison)
      })

      await service.method1()
      expect(comparisons).toHaveLength(0)
    })

    it('IF the durations do not differ by more than the predefined threshold, nothing is logged', async () => {
      const fastImpl = {
        method1: async () => 'fast',
        method2: async () => 'method2',
        method3: async () => 'method3',
      }

      const comparisons: any[] = []
      featureFlag = async () => 'new-compare'
      const service = Strangler(
        featureFlag,
        fastImpl,
        { ...fastImpl },
        (comparison) => {
          comparisons.push(comparison)
        },
        { acceptableDurationDifference: 1000 },
      )

      await service.method1()
      expect(comparisons).toHaveLength(0)
    })

    it('WILL NOT compare implementations when not in compare mode', async () => {
      for (const mode of ['old', 'new']) {
        const comparisons: unknown[] = []
        const featureFlag = async () => mode as StranglerMode
        const service = Strangler(featureFlag, newImpl, oldImpl, (comparison) => {
          comparisons.push(comparison)
        })

        expect(await service.method1()).toBe(mode)
      }
    })

    it('WILL include all arguments in the OnComparison result.', async () => {
      const comparisons: any[] = []
      featureFlag = async () => 'new-compare'

      // Create a promise that will resolve when onComparison is called
      let resolveComparisonPromise: () => void
      const comparisonPromise = new Promise<void>((resolve) => {
        resolveComparisonPromise = resolve
      })

      const service = Strangler(featureFlag, newImpl, oldImpl, (comparison) => {
        comparisons.push(comparison)
        resolveComparisonPromise()
      })

      await service.method1('test', 123)

      // Wait for the comparison to be completed
      await comparisonPromise

      expect(comparisons[0].parameters).toEqual(['test', 123])
    })

    it('WILL NOT wait for the slowest of the two operations to complete before returning the one in use.', async () => {
      // Create a very slow implementation
      const verySlowImpl = {
        method1: async () => {
          await new Promise((resolve) => setTimeout(resolve, 500))
          return 'very-slow'
        },
        method2: async () => 'method2',
        method3: async () => 'method3',
      }

      // Create a fast implementation
      const fastImpl = {
        method1: async () => {
          return 'fast'
        },
        method2: async () => 'method2',
        method3: async () => 'method3',
      }

      // Test with old-compare mode (using the fast implementation)
      featureFlag = async () => 'old-compare'
      const service = Strangler(
        featureFlag,
        verySlowImpl, // new implementation (slow)
        fastImpl, // old implementation (fast)
        () => {}, // empty comparison function
      )

      // Measure how long it takes to get the result
      const startTime = performance.now()
      const result = await service.method1()
      const duration = performance.now() - startTime

      // Verify that we got the result from the fast implementation
      expect(result).toBe('fast')

      // Verify that the duration is much less than 500ms (the time of the slow implementation)
      // We allow some buffer time for test execution overhead
      expect(duration).toBeLessThan(300)
    })

    it('WILL wait for the slowest of the two operations to complete before returning the one in use if requested in the options', async () => {
      // Create a very slow implementation
      const verySlowImpl = {
        method1: async () => {
          await new Promise((resolve) => setTimeout(resolve, 500))
          return 'very-slow'
        },
        method2: async () => 'method2',
        method3: async () => 'method3',
      }

      // Create a fast implementation
      const fastImpl = {
        method1: async () => {
          return 'fast'
        },
        method2: async () => 'method2',
        method3: async () => 'method3',
      }

      // Test with old-compare mode (using the fast implementation)
      featureFlag = async () => 'old-compare'
      const service = Strangler(
        featureFlag,
        verySlowImpl, // new implementation (slow)
        fastImpl, // old implementation (fast)
        () => {}, // empty comparison function
        {
          waitForComparison: true,
        },
      )

      // Measure how long it takes to get the result
      const startTime = performance.now()
      const result = await service.method1()
      const duration = performance.now() - startTime

      // Verify that we got the result from the fast implementation
      expect(result).toBe('fast')

      // Verify that the duration is more than 300ms (way slower than the time of the fast implementation)
      // As we are waiting for the slow implementation to complete
      expect(duration).toBeGreaterThanOrEqual(300)
    })

    it('WILL throw errors from the primary implementation directly to the caller', async () => {
      // Create an implementation that throws an error
      const errorImpl = {
        method1: async () => {
          throw new Error('Primary implementation error')
        },
        method2: async () => 'method2',
        method3: async () => 'method3',
      }

      // Create a normal implementation
      const normalImpl = {
        method1: async () => {
          return 'normal'
        },
        method2: async () => 'method2',
        method3: async () => 'method3',
      }

      // Test with old-compare mode (using the implementation that throws)
      featureFlag = async () => 'old-compare'
      const service = Strangler(
        featureFlag,
        normalImpl as any, // new implementation (not used for result)
        errorImpl as any, // old implementation (throws error)
      )

      // Verify that the error is thrown to the caller
      await expect(service.method1()).rejects.toThrow('Primary implementation error')
    })

    it('IF a parallel compare service fails, the onCompare function will be called with the error as the result.', async () => {
      const oldImpl = {
        method1: async () => 'old',
      }
      const newImpl = {
        method1: async () => {
          throw new Error('New implementation failed')
        },
      }

      const comparisons: any[] = []

      // Create a promise that will resolve when onComparison is called
      let resolveComparisonPromise: () => void
      const comparisonPromise = new Promise<void>((resolve) => {
        resolveComparisonPromise = resolve
      })

      const service = Strangler(
        async () => 'old-compare',
        newImpl,
        oldImpl,
        (comparison) => {
          comparisons.push(comparison)
          resolveComparisonPromise()
        },
      )

      const result = await service.method1()

      // Wait for the comparison to be completed
      await comparisonPromise

      expect(result).toBe('old')
      expect(comparisons).toHaveLength(1)
      expect(comparisons[0]).toEqual(
        expect.objectContaining({
          oldResult: 'old',
          newResult: new Error('New implementation failed'),
        }),
      )
    })

    it('WILL include the equality metadata in the onComparison result.', async () => {
      const comparisons: any[] = []
      featureFlag = async () => 'new-compare'

      // Create a promise that will resolve when onComparison is called
      let resolveComparisonPromise: () => void
      const comparisonPromise = new Promise<void>((resolve) => {
        resolveComparisonPromise = resolve
      })

      const service = Strangler(
        featureFlag,
        newImpl,
        oldImpl,
        (comparison) => {
          comparisons.push(comparison)
          resolveComparisonPromise()
        },
        {
          equalityFn: (a, b) => ({
            isEqual: a === b,
            metadata: {
              failingPath: 'createdBy',
              scheduleId: '123',
            },
          }),
        },
      )

      const result = await service.method1()

      // Wait for the comparison to be completed
      await comparisonPromise

      expect(comparisons).toHaveLength(1)
      expect(comparisons[0]).toMatchObject({
        oldResult: 'old',
        newResult: 'new',
        methodName: 'method1',
      })
      expect(result).toBe('new')
      expect(comparisons[0].equalityMetadata).toEqual({
        failingPath: 'createdBy',
        scheduleId: '123',
      })
    })
  })
  describe('Configuration Features.', () => {
    it('WILL support configuring the performance threshold', async () => {
      // This is covered by the 'Comparison Features' test cases.
      return
    })
  })
  describe('Error Scenarios', () => {
    it('WILL log an error and revert to "old", if the feature flag returns an unknown value', async () => {
      const oldImpl = {
        method1: async () => 'old',
      }
      const newImpl = {
        method1: async () => 'new',
      }

      const featureFlag = async () => 'invalid-mode' as StranglerMode
      const errors: any[] = []
      const errorLogger = (error: Error) => errors.push(error)

      const service = Strangler(featureFlag, newImpl, oldImpl, undefined, {
        logger: {
          error: errorLogger,
        },
      })

      const result = await service.method1()

      expect(result).toBe('old')
      expect(errors).toHaveLength(1)
      expect(errors[0].message).toContain('Invalid StranglerMode: invalid-mode')
    })
    it('IF a parallel compare service fails (but is not used for response), DO NOT fail the response.', async () => {
      const oldImpl = {
        method1: async () => 'old',
      }
      const newImpl = {
        method1: async () => {
          throw new Error('New implementation failed')
        },
      }

      let featureFlag = 'old-compare'
      const comparisons: any[] = []

      const service = Strangler(
        async () => featureFlag,
        newImpl,
        oldImpl,
        (comparison) => {
          comparisons.push(comparison)
        },
      )

      const result = await service.method1()
      expect(result).toBe('old')

      featureFlag = 'new-compare'
      expect(service.method1()).rejects.toThrow()
    })
    it('IF a parallel compare service fails (waited, but not used for response), DO NOT fail the response.', async () => {
      const oldImpl = {
        method1: async () => 'old',
      }
      const newImpl = {
        method1: async () => {
          throw new Error('New implementation failed')
        },
      }

      let featureFlag = 'old-compare'
      const comparisons: any[] = []

      const service = Strangler(
        async () => featureFlag,
        newImpl,
        oldImpl,
        (comparison) => {
          comparisons.push(comparison)
        },
        {
          waitForComparison: true,
        },
      )

      const result = await service.method1()
      expect(result).toBe('old')

      featureFlag = 'new-compare'
      expect(service.method1()).rejects.toThrow()
    })
    it('IF a parallel compare service fails, the onCompare function will be called with the error as the result.', async () => {
      const oldImpl = {
        method1: async () => 'old',
      }
      const newImpl = {
        method1: async () => {
          throw new Error('New implementation failed')
        },
      }

      const comparisons: any[] = []

      // Create a promise that will resolve when onComparison is called
      let resolveComparisonPromise: () => void
      const comparisonPromise = new Promise<void>((resolve) => {
        resolveComparisonPromise = resolve
      })

      const service = Strangler(
        async () => 'old-compare',
        newImpl,
        oldImpl,
        (comparison) => {
          comparisons.push(comparison)
          resolveComparisonPromise()
        },
      )

      const result = await service.method1()

      await comparisonPromise

      expect(result).toBe('old')
      expect(comparisons).toHaveLength(1)
      expect(comparisons[0]).toEqual(
        expect.objectContaining({
          oldResult: 'old',
          newResult: new Error('New implementation failed'),
        }),
      )
    })

    it('IF equality function throws, do not fail the response.', async () => {
      const oldImpl = {
        method1: async () => 'old',
      }
      const newImpl = {
        method1: async () => 'new',
      }

      const service = Strangler(async () => 'new-compare', newImpl, oldImpl, undefined, {
        equalityFn: () => {
          throw new Error('Equality function failed')
        },
      })

      const result = await service.method1()
      expect(result).toBe('new')
    })

    it('IF comparison function throws, do not fail the response.', async () => {
      const oldImpl = {
        method1: async () => 'old',
      }
      const newImpl = {
        method1: async () => 'new',
      }

      const service = Strangler(
        async () => 'new-compare',
        newImpl,
        oldImpl,
        () => {
          throw new Error('Comparison function failed')
        },
        {
          logger: mockLogger,
        },
      )

      const result = await service.method1()
      expect(result).toBe('new')
    })
  })
})
