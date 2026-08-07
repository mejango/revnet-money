// The ETH price converts real treasury balances into figures people read as fact, and the
// shields badge publishes one of them off-site. A failed feed must therefore be reported as
// "no price", never as a stand-in number — a hard-coded fallback used to live here and made
// every caller's honest-degradation path unreachable.
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
}))

const { fetchEthPrice } = await import('@/lib/ethPrice')

afterEach(() => vi.unstubAllGlobals())

describe('fetchEthPrice', () => {
  it('returns null when the feed is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await expect(fetchEthPrice()).resolves.toBeNull()
  })

  it('returns null on a non-OK response rather than parsing an error body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    await expect(fetchEthPrice()).resolves.toBeNull()
  })

  it('returns null when the feed answers without a usable price', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ price: 'n/a' }) }),
    )
    await expect(fetchEthPrice()).resolves.toBeNull()
  })

  it('returns the price when the feed answers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ price: '3421.5' }) }),
    )
    await expect(fetchEthPrice()).resolves.toBe(3421.5)
  })
})
