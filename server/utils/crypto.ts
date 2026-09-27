// 密码哈希 —— 只用 node:crypto 的 scryptSync，不引入任何原生依赖（容器零编译负担）
//
// 存储格式：scrypt$N$r$p$saltHex$hashHex
// 参数：N=16384, r=8, p=1, keylen=64, salt=16 字节（实测约 36ms/次，可接受）
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto'

const N = 16384
const R = 8
const P = 1
const KEYLEN = 64
const SALT_BYTES = 16

/** 生成密码哈希字符串，格式 scrypt$N$r$p$saltHex$hashHex */
export function hashPassword(pw: string): string {
  const salt = randomBytes(SALT_BYTES)
  const hash = scryptSync(pw, salt, KEYLEN, { N, r: R, p: P })
  return `scrypt$${N}$${R}$${P}$${salt.toString('hex')}$${hash.toString('hex')}`
}

/**
 * 校验密码。
 * 注意：timingSafeEqual 在两侧长度不等时会直接 throw。
 * 因此这里先解析出 expect 的长度，再按该长度生成 actual —— 保证长度必然一致；
 * 即便如此仍保留一层长度防御，避免任何异常路径导致 500。
 */
export function verifyPassword(pw: string, stored: string): boolean {
  if (!stored || typeof stored !== 'string') return false
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const n = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p) || n <= 0 || r <= 0 || p <= 0) return false
  let salt: Buffer
  let expect: Buffer
  try {
    salt = Buffer.from(parts[4], 'hex')
    expect = Buffer.from(parts[5], 'hex')
  } catch {
    return false
  }
  if (!salt.length || !expect.length) return false
  let actual: Buffer
  try {
    actual = scryptSync(pw, salt, expect.length, { N: n, r, p })
  } catch {
    return false
  }
  if (actual.length !== expect.length) return false
  try {
    return timingSafeEqual(actual, expect)
  } catch {
    return false
  }
}

/** 一个恒定存在的假哈希：用户名不存在时也跑一次比对，抹平登录耗时，防账号枚举 */
export const DUMMY_HASH = hashPassword('__no_such_user__')
