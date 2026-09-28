import * as submissions from './submissions'
import * as admins from './admins'
import * as campaigns from './campaigns-settings'
import { databaseReadiness } from '../../infrastructure/database/sqlite'
import type { AdminRepository, CampaignRepository, SubmissionRepository } from '../contracts'
import type { Identity } from '../../domain/auth/identity'

export class SqliteSubmissionRepository implements SubmissionRepository {
  create(input: Record<string, unknown>) { return submissions.createSubmission(input) }
  findByStudent(studentId: string, campaignId?: string) { return submissions.findByStudentId(studentId, campaignId) }
  findPublicByCodeAndStudent(code: string, studentId: string) { return submissions.findPublicByCodeAndStudent(code, studentId) }
  findByCodeAndStudent(code: string, studentId: string) { return submissions.getByCodeAndStudent(code, studentId) }
  listForAdmin(me: Identity, status: string, search: string, page: number, size = 20, deptFilter: string | null = null) {
    return submissions.listSubmissions(me, status, search, page, size, deptFilter)
  }
  update(me: Identity, id: number, fields: { status?: string; admin_note?: string }) { return submissions.updateSubmission(me, id, fields) }
  getById(id: number) { return submissions.getSubmissionById(id) }
  delete(id: number) { submissions.deleteSubmission(id) }
  reassign(id: number, to: string, by: number) { submissions.reassignDept(id, to, by) }
  stats(me: Identity) { return submissions.stats(me) }
  statsByDept() { return submissions.statsByDept() }
  export(me: Identity) { return submissions.allForExport(me) as any[] }
  getFileOwner(name: string) { return submissions.getFileOwner(name) }
}

export class SqliteCampaignRepository implements CampaignRepository {
  getCurrent() { return campaigns.getCurrentCampaign() }
  getById(id: string) { return campaigns.getCampaignById(id) }
  list() { return campaigns.listCampaigns() }
  create(input: { id: string; year: number; slug: string; name: string; status?: string; starts_at?: string; ends_at?: string }) {
    return campaigns.createCampaign(input)
  }
}

export class SqliteAdminRepository implements AdminRepository {
  getByUsername(username: string) { return admins.getAdminByUsername(username) }
  getById(id: number) { return admins.getAdminById(id) }
  create(username: string, password: string, role: string, dept: string, displayName: string) {
    return admins.createAdmin(username, password, role, dept, displayName)
  }
  list() { return admins.listAdmins() as any[] }
  updatePassword(id: number, password: string) { admins.updateAdminPassword(id, password) }
  bumpSession(id: number) { admins.bumpAdminSession(id) }
  setActive(id: number, active: boolean) { admins.setAdminActive(id, active) }
  updateRole(id: number, role: string, dept: string) { admins.updateAdminRole(id, role, dept) }
  countActiveSupers(excludeId = 0) { return admins.countActiveSupers(excludeId) }
  hasAny() { return admins.hasAnyAdmin() }
  audit(actorId: number, actorName: string, action: string, target: string, detail: string) {
    admins.audit(actorId, actorName, action, target, detail)
  }
}


export class SqliteSettingsRepository {
  get(key: string) { return campaigns.getSetting(key) }
  set(key: string, value: string) { campaigns.setSetting(key, value) }
}

export class SqliteHealthRepository {
  check() { return databaseReadiness() }
}
