// 部门字典 —— 单一数据源（Single Source of Truth）
//
// 设计要点：
// 1) subscriptions.dept 存「稳定 key」（英文），不存中文名 —— 部门改名时数据不动；
// 2) 不建 departments 表：部门是业务定义而非用户数据，「作品是否必填」是代码策略，
//    放 DB 只会引入「两份字典要同步」的新坑；
// 3) 前端的部门下拉一律从 GET /api/departments 取，严禁前端硬编码，避免再次分叉。
//
// 命名导出 → Nitro auto-import 自动生效（项目现有代码即依赖此机制），
// 因此各 server 文件里直接使用 DEPARTMENTS / DEPT_KEYS / deptName / deptPolicy，
// 无需写 import 语句。

/** 作品策略：required=作品必填（作品链接或作品附件至少一个）；hidden=隐藏作品区块、不接受作品 */
export type WorkPolicy = 'required' | 'hidden'

export interface Department {
  /** 稳定 key，落库用这个 */
  key: string
  /** 展示名 */
  name: string
  /** 作品策略 */
  work: WorkPolicy
}

/** 部门字典（业务已确认：除文秘部外全部必填作品） */
export const DEPARTMENTS = [
  { key: 'game', name: '游戏开发部', work: 'required' },
  { key: 'ai', name: '人工智能部', work: 'required' },
  { key: 'dev', name: '软件开发部', work: 'required' },
  { key: 'secretary', name: '文秘部', work: 'hidden' },
] as const satisfies readonly Department[]

/** 合法部门 key 白名单（用于服务端入参校验） */
export const DEPT_KEYS: string[] = DEPARTMENTS.map(d => d.key)

/** key → 中文名；未知 key 返回空串（fail-safe，不抛错） */
export function deptName(key: string): string {
  return DEPARTMENTS.find(d => d.key === key)?.name || ''
}

/** key → 部门策略对象；未知 key 返回 undefined（调用方需自行判断） */
export function deptPolicy(key: string): Department | undefined {
  return DEPARTMENTS.find(d => d.key === key)
}
