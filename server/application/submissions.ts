import type { Identity } from '../domain/auth/identity'
import type { SubmissionRepository } from '../repositories/contracts'

export function createSubmissionsApp(submissions: SubmissionRepository) {
  return Object.freeze({
    create(input: Record<string, unknown>) { return submissions.create(input) },
    findByStudent(studentId: string, campaignId?: string) { return submissions.findByStudent(studentId, campaignId) },
    findPublicByCodeAndStudent(code: string, studentId: string) {
      return submissions.findPublicByCodeAndStudent(code, studentId)
    },
    findByCodeAndStudent(code: string, studentId: string) { return submissions.findByCodeAndStudent(code, studentId) },
    list(me: Identity, status: string, search: string, page: number, size = 20, deptFilter: string | null = null) {
      return submissions.listForAdmin(me, status, search, page, size, deptFilter)
    },
    update(me: Identity, id: number, fields: { status?: string; admin_note?: string }) {
      return submissions.update(me, id, fields)
    },
    getById(id: number) { return submissions.getById(id) },
    remove(id: number) { return submissions.delete(id) },
    reassign(id: number, to: string, by: number) { return submissions.reassign(id, to, by) },
    stats(me: Identity) { return submissions.stats(me) },
    statsByDept() { return submissions.statsByDept() },
    export(me: Identity) { return submissions.export(me) },
    fileOwner(name: string) { return submissions.getFileOwner(name) },
  })
}
