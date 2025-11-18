/**
 * Basic test to verify test infrastructure is working
 */

import { describe, it, expect } from 'vitest'

describe('Test Infrastructure', () => {
  it('should run tests', () => {
    expect(true).toBe(true)
  })

  it('should have access to vitest globals', () => {
    expect(describe).toBeDefined()
    expect(it).toBeDefined()
    expect(expect).toBeDefined()
  })
})
