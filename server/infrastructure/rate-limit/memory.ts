import type { RateLimitPolicy, RateLimitResult, RateLimiter } from '../../repositories/contracts'

export class MemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, number[]>()

  check(key: string, policy: RateLimitPolicy): RateLimitResult {
    const now = Date.now()
    const recent = (this.buckets.get(key) || []).filter((time) => now - time < policy.windowMs)
    if (recent.length >= policy.maxAttempts) {
      this.buckets.set(key, recent)
      return { allowed: false, retryAfterMs: Math.max(0, policy.windowMs - (now - recent[0])) }
    }
    recent.push(now)
    this.buckets.set(key, recent)
    if (this.buckets.size > 5000) {
      for (const [bucketKey, times] of this.buckets) {
        if (times.every((time) => now - time >= policy.windowMs)) this.buckets.delete(bucketKey)
      }
    }
    return { allowed: true, retryAfterMs: 0 }
  }

  reset(key: string) {
    this.buckets.delete(key)
  }
}

export const memoryRateLimiter = new MemoryRateLimiter()
