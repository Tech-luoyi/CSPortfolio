// 部门字典（前端）—— 唯一来源是 GET /api/departments。
// 服务端 server/utils/departments.ts 是单一数据源，前端严禁硬编码部门名/key，
// 否则「作品是否必填」这类策略又会分叉成两份。

export interface Department {
  key: string
  name: string
  work: 'required' | 'hidden'
}

interface DepartmentsResponse {
  ok: boolean
  departments: Department[]
}

/**
 * 拉取部门字典。SSR / 客户端同构（useFetch 会处理首屏 payload 传递）。
 * 显式指定 key，多个页面同时调用时复用同一份请求。
 */
export function useDepartments() {
  const { data, error: fetchError } = useFetch<DepartmentsResponse>('/api/departments', { key: 'departments' })

  const departments = computed<Department[]>(() => data.value?.departments || [])

  /** key → 中文名；未知 key 返回空串（与服务端 deptName 一致，fail-safe 不抛错） */
  function deptName(key: string): string {
    return departments.value.find(d => d.key === key)?.name || ''
  }

  /** key → 部门策略；未知 key 返回 undefined */
  function deptPolicy(key: string): Department | undefined {
    return departments.value.find(d => d.key === key)
  }

  return { departments, deptName, deptPolicy, error: fetchError }
}

/**
 * 取服务端返回给用户看的话。
 * 服务端一律用 createError({ statusCode, statusMessage }) 抛业务错误，
 * 因此 statusMessage 优先；缺失时退回 message。
 */
export function apiErrorMessage(e: any, fallback = '操作失败，请稍后再试'): string {
  return e?.data?.statusMessage || e?.data?.message || fallback
}

/** 判断是否为 401（登录态失效），兼容 FetchError 的几种状态字段位置 */
export function isUnauthorized(e: any): boolean {
  return e?.status === 401 || e?.statusCode === 401 || e?.data?.statusCode === 401
}
