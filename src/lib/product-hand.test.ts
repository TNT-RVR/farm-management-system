import { describe, expect, it } from 'vitest'
import { handAddedProduct } from './product-hand'

describe('handAddedProduct', () => {
  it('is only a product nothing from Deere, an invoice or the sprayer points at', () => {
    expect(handAddedProduct({ aliases: 0, purchases: 0, applications: 0 })).toBe(true)
    expect(handAddedProduct({ aliases: 1, purchases: 0, applications: 0 })).toBe(false)
    expect(handAddedProduct({ aliases: 0, purchases: 2, applications: 0 })).toBe(false)
    expect(handAddedProduct({ aliases: 0, purchases: 0, applications: 3 })).toBe(false)
  })
})
