import type { AdminRepository } from '../repositories/contracts'

export function createAdminApp(admins: AdminRepository) {
  return Object.freeze({
    getByUsername(username: string) { return admins.getByUsername(username) },
    getById(id: number) { return admins.getById(id) },
    create(username: string, password: string, role: string, dept: string, displayName: string) {
      return admins.create(username, password, role, dept, displayName)
    },
    list() { return admins.list() },
    updatePassword(id: number, password: string) { return admins.updatePassword(id, password) },
    bumpSession(id: number) { return admins.bumpSession(id) },
    setActive(id: number, active: boolean) { return admins.setActive(id, active) },
    updateRole(id: number, role: string, dept: string) { return admins.updateRole(id, role, dept) },
    countActiveSupers(excludeId = 0) { return admins.countActiveSupers(excludeId) },
    hasAny() { return admins.hasAny() },
    audit(actorId: number, actorName: string, action: string, target: string, detail: string) {
      return admins.audit(actorId, actorName, action, target, detail)
    },
  })
}
