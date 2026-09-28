import { verifyPassword, DUMMY_HASH } from '../utils/crypto'
import type { AdminRepository } from '../repositories/contracts'

export function createAuthApp(admins: Pick<AdminRepository, 'getByUsername'>) {
  return Object.freeze({
    authenticateAdmin(username: string, password: string): any | null {
      const admin = username ? admins.getByUsername(username) : null
      let ok = false
      if (admin && admin.is_active) ok = verifyPassword(password, admin.password_hash)
      else verifyPassword(password, DUMMY_HASH)
      return ok ? admin : null
    },
  })
}
