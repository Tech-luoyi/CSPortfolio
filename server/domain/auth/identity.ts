export interface Identity {
  id: number
  username: string
  role: 'dept' | 'super' | string
  dept: string
  display_name: string
}

/** null means unrestricted and can only be produced by a super administrator. */
export type Scope = string | null

export function deptOf(identity: Identity): Scope {
  if (!identity || !identity.role) throw new Error('deptOf: missing identity')
  return identity.role === 'super' ? null : identity.dept
}
