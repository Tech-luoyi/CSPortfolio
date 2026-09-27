<script setup lang="ts">
// 管理后台 —— 无锡学院计算机协会 简历作品审核
import { useDepartments, apiErrorMessage, isUnauthorized } from '~/composables/useDepartments'

useHead({ title: '管理后台 · 无锡学院计算机协会' })

const { departments, deptName, deptPolicy } = useDepartments()

interface Me { id: number; username: string; role: string; dept: string; display_name: string }

const me = ref<Me | null>(null)
const checking = ref(true)

const isSuper = computed(() => me.value?.role === 'super')
// 顶部身份标识：超管显示「超级管理员」，部门账号显示对应部门中文名
const meLabel = computed(() => (me.value ? (me.value.display_name || me.value.username) : ''))
const meRoleLabel = computed(() => {
  if (!me.value) return ''
  return me.value.role === 'super' ? '超级管理员' : (deptName(me.value.dept) || '部门账号')
})
const meUsername = computed(() => me.value?.username || '')
const isSelf = (u: any) => me.value?.id === u.id

// ---------- 登录 ----------
const loginForm = reactive({ username: '', password: '' })
const loginError = ref('')
const loginLoading = ref(false)

// ---------- 列表 ----------
const rows = ref<any[]>([])
const stats = ref<any>(null)
const byDept = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const statusFilter = ref('all')
const deptFilter = ref('')
const search = ref('')
const listLoading = ref(false)
const listError = ref('')
const size = 20

const statusText: Record<string, string> = {
  pending: '待审核', reviewing: '审核中', accepted: '免试通过', rejected: '未通过'
}
const statusTabs = [
  { key: 'all', label: '全部' }, { key: 'pending', label: '待审核' },
  { key: 'reviewing', label: '审核中' }, { key: 'accepted', label: '免试通过' },
  { key: 'rejected', label: '未通过' }
]

const zeroStats = () => ({ total: 0, pending: 0, reviewing: 0, accepted: 0, rejected: 0 })

// 关键：super 的 stats 是全局数字，不随 dept 筛选变化。
// 因此切到某个部门时，统计与状态标签上的数字必须改用 byDept 里该部门的值。
const effectiveStats = computed(() => {
  if (!isSuper.value || !deptFilter.value) return stats.value || zeroStats()
  return byDept.value.find(d => d.dept === deptFilter.value) || zeroStats()
})

// 部门标签页（全部 + 字典里的部门），数字取 byDept
const deptTabs = computed(() => [
  { key: '', name: '全部', total: stats.value?.total || 0 },
  ...departments.value.map(d => ({
    key: d.key,
    name: d.name,
    total: byDept.value.find(x => x.dept === d.key)?.total || 0
  }))
])

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / size)))
const hasWork = (r: any) => !!(r?.work_url || r?.work_path)

function tabCount(key: string) {
  const s = effectiveStats.value
  return key === 'all' ? (s.total || 0) : (s[key] || 0)
}

async function checkMe() {
  try {
    const res: any = await $fetch('/api/admin/me')
    me.value = res?.me || null
    if (me.value) await afterLogin()
  } catch {
    me.value = null
  } finally {
    checking.value = false
  }
}

async function afterLogin() {
  page.value = 1
  showUsers.value = false
  showAnnouncement.value = false
  await load()
  if (isSuper.value) {
    await loadUsers()
    await loadAnnouncement()
  }
}

async function login() {
  loginError.value = ''
  if (!loginForm.username.trim() || !loginForm.password) { loginError.value = '请输入用户名和密码'; return }
  loginLoading.value = true
  try {
    const res: any = await $fetch('/api/admin/login', {
      method: 'POST',
      body: { username: loginForm.username.trim(), password: loginForm.password }
    })
    me.value = res?.me || null
    loginForm.password = ''
    if (me.value) await afterLogin()
  } catch (e: any) {
    loginError.value = apiErrorMessage(e, '登录失败，请稍后再试')
  } finally {
    loginLoading.value = false
  }
}

async function logout() {
  try {
    await $fetch('/api/admin/logout', { method: 'POST' })
  } catch { /* 即使服务端不可达，也清理本地 cookie 和页面状态 */ }
  // 清 cookie 只能走 document，放在事件回调里（SSR 不会执行到）
  if (import.meta.client) document.cookie = 'jx_admin_v2=; Max-Age=0; path=/'
  resetToLoggedOut()
}

/** 登录态失效（401）或主动退出后回到登录态 */
function resetToLoggedOut() {
  me.value = null
  rows.value = []
  total.value = 0
  stats.value = null
  byDept.value = []
  page.value = 1
  detail.value = null
  users.value = []
  showUsers.value = false
  showAnnouncement.value = false
  loginForm.password = ''
}

async function load() {
  listLoading.value = true
  listError.value = ''
  try {
    const params: any = { status: statusFilter.value, search: search.value, page: page.value }
    // dept 参数只有 super 生效；部门账号不传，避免产生「筛选了」的误导
    if (isSuper.value && deptFilter.value) params.dept = deptFilter.value
    const res: any = await $fetch('/api/admin/submissions', { params })
    rows.value = res?.data?.rows || []
    total.value = res?.data?.total || 0
    stats.value = res?.stats || null
    byDept.value = res?.byDept || []
  } catch (e: any) {
    if (isUnauthorized(e)) { resetToLoggedOut(); return }
    listError.value = apiErrorMessage(e, '加载失败，请稍后重试')
  } finally {
    listLoading.value = false
  }
}

function switchStatus(k: string) { statusFilter.value = k; page.value = 1; load() }
function switchDept(k: string) { deptFilter.value = k; page.value = 1; load() }
function doSearch() { page.value = 1; load() }
function turn(delta: number) {
  const next = page.value + delta
  if (next < 1 || next > pageCount.value) return
  page.value = next
  load()
}

// ---------- 详情 / 审核 ----------
const detail = ref<any>(null)
const noteEdit = ref('')
const detailError = ref('')
const detailBusy = ref(false)
const reassignTo = ref('')
const reassignWarning = ref('')

// 文秘部（work=hidden）不显示作品栏；其余部门照常显示
const detailShowsWork = computed(() => {
  if (!detail.value) return false
  return deptPolicy(detail.value.dept)?.work !== 'hidden'
})

function openDetail(r: any) {
  detail.value = r
  noteEdit.value = r.admin_note || ''
  detailError.value = ''
  reassignTo.value = r.dept || ''
  reassignWarning.value = ''
}

async function patchDetail(body: any) {
  detailError.value = ''
  detailBusy.value = true
  try {
    await $fetch(`/api/admin/submissions/${detail.value.id}`, { method: 'PATCH', body })
    detail.value = null
    await load()
  } catch (e: any) {
    if (isUnauthorized(e)) { resetToLoggedOut(); return }
    detailError.value = apiErrorMessage(e, '保存失败，请稍后重试')
  } finally {
    detailBusy.value = false
  }
}

const setStatus = (status: string) => patchDetail({ status })
const saveNote = () => patchDetail({ admin_note: noteEdit.value })
const saveNoteAndAccept = () => patchDetail({ admin_note: noteEdit.value, status: 'accepted' })

async function doReassign() {
  detailError.value = ''
  reassignWarning.value = ''
  if (!reassignTo.value) { detailError.value = '请选择目标部门'; return }
  detailBusy.value = true
  try {
    const res: any = await $fetch(`/api/admin/submissions/${detail.value.id}/reassign`, {
      method: 'POST', body: { dept: reassignTo.value }
    })
    detail.value = null
    await load()
    // warning 非空必须让用户看到（例如改到作品必填部门但该记录没有作品）
    if (res?.warning) {
      reassignWarning.value = res.warning
      if (import.meta.client) alert(`改派已完成，但请注意：\n${res.warning}`)
    }
  } catch (e: any) {
    if (isUnauthorized(e)) { resetToLoggedOut(); return }
    detailError.value = apiErrorMessage(e, '改派失败')
  } finally {
    detailBusy.value = false
  }
}

// ---------- 账号管理（仅 super） ----------
const users = ref<any[]>([])
const showUsers = ref(false)
const usersError = ref('')
const usersOk = ref('')
const userBusy = ref(false)
const newUser = reactive({ username: '', password: '', display_name: '', role: 'dept', dept: '' })
const editId = ref<number | null>(null)
const editForm = reactive({ password: '', role: 'dept', dept: '' })

async function loadUsers() {
  if (!isSuper.value) return
  try {
    const res: any = await $fetch('/api/admin/users')
    users.value = res?.users || []
  } catch (e: any) {
    if (isUnauthorized(e)) { resetToLoggedOut(); return }
    usersError.value = apiErrorMessage(e, '账号列表加载失败')
  }
}

async function createUser() {
  usersError.value = ''
  usersOk.value = ''
  if (!/^[A-Za-z0-9_]{3,20}$/.test(newUser.username.trim())) { usersError.value = '用户名需 3-20 位字母、数字或下划线'; return }
  if (newUser.password.length < 8) { usersError.value = '密码至少 8 位'; return }
  if (newUser.role === 'dept' && !newUser.dept) { usersError.value = '请选择所属部门'; return }
  userBusy.value = true
  try {
    await $fetch('/api/admin/users', {
      method: 'POST',
      body: {
        username: newUser.username.trim(),
        password: newUser.password,
        display_name: newUser.display_name.trim(),
        role: newUser.role,
        dept: newUser.role === 'dept' ? newUser.dept : ''
      }
    })
    usersOk.value = `账号「${newUser.username.trim()}」已创建`
    Object.assign(newUser, { username: '', password: '', display_name: '', role: 'dept', dept: '' })
    await loadUsers()
  } catch (e: any) {
    usersError.value = apiErrorMessage(e, '创建失败')
  } finally {
    userBusy.value = false
  }
}

function openEdit(u: any) {
  editId.value = editId.value === u.id ? null : u.id
  editForm.password = ''
  editForm.role = u.role
  editForm.dept = u.dept || departments.value[0]?.key || ''
  usersError.value = ''
  usersOk.value = ''
}

async function saveUser(u: any) {
  usersError.value = ''
  usersOk.value = ''
  const body: any = {}
  if (editForm.password) {
    if (editForm.password.length < 8) { usersError.value = '密码至少 8 位'; return }
    body.password = editForm.password
  }
  const self = me.value?.id === u.id
  // 服务端禁止修改自己的角色；对自己不下发 role
  if (!self && editForm.role !== u.role) {
    body.role = editForm.role
    if (editForm.role === 'dept') body.dept = editForm.dept
  } else if (u.role === 'dept' && editForm.dept && editForm.dept !== u.dept) {
    body.dept = editForm.dept
  }
  if (!Object.keys(body).length) { usersError.value = '没有需要保存的改动'; return }
  userBusy.value = true
  try {
    await $fetch(`/api/admin/users/${u.id}`, { method: 'PATCH', body })
    usersOk.value = `账号「${u.username}」已更新`
    editId.value = null
    await loadUsers()
  } catch (e: any) {
    usersError.value = apiErrorMessage(e, '保存失败')
  } finally {
    userBusy.value = false
  }
}

async function toggleActive(u: any) {
  usersError.value = ''
  usersOk.value = ''
  userBusy.value = true
  try {
    await $fetch(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { is_active: !u.is_active } })
    usersOk.value = u.is_active ? `已停用「${u.username}」` : `已启用「${u.username}」`
    await loadUsers()
  } catch (e: any) {
    usersError.value = apiErrorMessage(e, '操作失败')
  } finally {
    userBusy.value = false
  }
}

// ---------- 公告设置（仅 super） ----------
// 公开 GET 读当前公告；POST 保存（服务端 403 仅超管，前端只在 super 渲染编辑区，403 仍做兜底）
const showAnnouncement = ref(false)
const announcement = ref('')
const announcementEdit = ref('')
const announcementError = ref('')
const announcementOk = ref('')
const announcementBusy = ref(false)

async function loadAnnouncement() {
  try {
    const res: any = await $fetch('/api/announcement')
    announcement.value = res?.announcement || ''
    announcementEdit.value = announcement.value
  } catch (e: any) {
    if (isUnauthorized(e)) { resetToLoggedOut(); return }
    announcementError.value = apiErrorMessage(e, '公告加载失败')
  }
}

function toggleAnnouncement() {
  showAnnouncement.value = !showAnnouncement.value
  if (showAnnouncement.value) {
    announcementError.value = ''
    announcementOk.value = ''
    loadAnnouncement()
  }
}

async function saveAnnouncement() {
  announcementError.value = ''
  announcementOk.value = ''
  announcementBusy.value = true
  try {
    await $fetch('/api/announcement', { method: 'POST', body: { announcement: announcementEdit.value } })
    announcement.value = announcementEdit.value
    announcementOk.value = '公告已保存'
  } catch (e: any) {
    if (isUnauthorized(e)) { resetToLoggedOut(); return }
    // 403（非超管）等业务错误都原样透出
    announcementError.value = apiErrorMessage(e, '保存失败，请稍后重试')
  } finally {
    announcementBusy.value = false
  }
}

// 登录态一律以 GET /api/admin/me 为准（不再靠「列表有没有数据」判断）
onMounted(() => { checkMe() })
</script>

<template>
  <div>
    <!-- 登录态校验中 -->
    <div v-if="checking" class="card" style="text-align:center; color:var(--muted); padding:40px 0">
      正在校验登录状态…
    </div>

    <!-- 登录 -->
    <div v-else-if="!me" class="card" style="max-width:400px; margin:40px auto; text-align:center">
      <div style="font-weight:800; font-size:18px; margin-bottom:4px">无锡学院计算机协会</div>
      <div style="font-size:13px; color:var(--muted); margin-bottom:20px">管理后台 · 仅协会管理层登录</div>
      <div v-if="loginError" class="alert alert-err">{{ loginError }}</div>
      <div class="field">
        <input v-model="loginForm.username" class="input" placeholder="用户名" autocomplete="username">
      </div>
      <div class="field">
        <input v-model="loginForm.password" type="password" class="input" placeholder="密码" autocomplete="current-password" @keyup.enter="login">
      </div>
      <button class="btn" :disabled="loginLoading" @click="login">{{ loginLoading ? '登录中…' : '登 录' }}</button>
    </div>

    <!-- 后台 -->
    <div v-else>
      <!-- 身份栏 -->
      <div class="card" style="padding:14px 18px; display:flex; align-items:center; gap:10px; flex-wrap:wrap">
        <div style="flex:1; min-width:0">
          <div style="font-weight:700; font-size:14.5px; display:flex; align-items:center; gap:8px; flex-wrap:wrap">
            {{ meLabel }}
            <span class="badge" style="background:var(--bg); color:var(--muted2)">{{ meRoleLabel }}</span>
          </div>
          <div style="font-size:12px; color:var(--muted); margin-top:2px">{{ meUsername }}</div>
        </div>
        <button v-if="isSuper" class="btn-sm btn btn-ghost" @click="showUsers = !showUsers">
          {{ showUsers ? '收起账号管理' : '账号管理' }}
        </button>
        <button v-if="isSuper" class="btn-sm btn btn-ghost" @click="toggleAnnouncement">
          {{ showAnnouncement ? '收起公告' : '公告设置' }}
        </button>
        <button class="btn-sm btn btn-ghost" @click="logout">退出登录</button>
      </div>

      <!-- 统计（super 切到具体部门时数字取 byDept） -->
      <div style="display:grid; grid-template-columns:repeat(5,1fr); gap:10px; margin-bottom:16px">
        <div v-for="(v, k) in { total: '总投递', pending: '待审核', reviewing: '审核中', accepted: '免试通过', rejected: '未通过' }" :key="k" class="card" style="padding:14px; text-align:center; margin:0">
          <div style="font-size:20px; font-weight:800; color:var(--primary)">{{ tabCount(k) }}</div>
          <div style="font-size:12px; color:var(--muted)">{{ v }}</div>
        </div>
      </div>

      <!-- 账号管理（仅 super） -->
      <div v-if="isSuper && showUsers" class="card">
        <div style="font-weight:700; font-size:15px; margin-bottom:12px">👤 账号管理</div>
        <div v-if="usersError" class="alert alert-err">{{ usersError }}</div>
        <div v-if="usersOk" class="alert alert-ok">{{ usersOk }}</div>

        <!-- 新建账号 -->
        <div style="background:var(--bg); border-radius:12px; padding:14px; margin-bottom:16px">
          <div style="font-weight:600; font-size:13.5px; margin-bottom:10px">新建账号</div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px">
            <input v-model="newUser.username" class="input" placeholder="用户名 3-20 位字母数字下划线">
            <input v-model="newUser.password" class="input" placeholder="密码 至少 8 位">
            <input v-model="newUser.display_name" class="input" placeholder="显示名（如：游戏开发部长）" maxlength="20">
            <select v-model="newUser.role" class="select">
              <option value="dept">部门账号</option>
              <option value="super">超级管理员</option>
            </select>
            <select v-if="newUser.role === 'dept'" v-model="newUser.dept" class="select" style="grid-column:1 / -1">
              <option value="" disabled>选择所属部门</option>
              <option v-for="d in departments" :key="d.key" :value="d.key">{{ d.name }}</option>
            </select>
          </div>
          <button class="btn btn-sm" style="margin-top:12px" :disabled="userBusy" @click="createUser">新建账号</button>
        </div>

        <!-- 账号列表 -->
        <div v-if="!users.length" class="empty">暂无后台账号</div>
        <div v-for="u in users" :key="u.id" style="border-top:1px solid var(--line); padding:12px 0">
          <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap">
            <div style="flex:1; min-width:0">
              <div style="font-size:14px; font-weight:600; display:flex; align-items:center; gap:8px; flex-wrap:wrap">
                {{ u.display_name || u.username }}
                <span class="badge" style="background:var(--bg); color:var(--muted2)">
                  {{ u.role === 'super' ? '超级管理员' : (deptName(u.dept) || '部门账号') }}
                </span>
                <span v-if="!u.is_active" class="badge rejected">已停用</span>
                <span v-if="isSelf(u)" class="badge" style="background:var(--bg); color:var(--muted2)">我</span>
              </div>
              <div style="font-size:12px; color:var(--muted); margin-top:2px">{{ u.username }} · 创建于 {{ u.created_at }}</div>
            </div>
            <button class="btn-sm btn btn-ghost" @click="openEdit(u)">{{ editId === u.id ? '收起' : '编辑' }}</button>
            <button
              class="btn-sm btn"
              :class="u.is_active ? 'btn-warn' : 'btn-ok'"
              :disabled="userBusy"
              @click="toggleActive(u)">{{ u.is_active ? '停用' : '启用' }}</button>
          </div>

          <!-- 行内编辑 -->
          <div v-if="editId === u.id" style="margin-top:12px; background:var(--bg); border-radius:12px; padding:14px">
            <div class="field" style="margin-bottom:10px">
              <label>新密码 <span class="tip">留空则不修改，至少 8 位</span></label>
              <input v-model="editForm.password" class="input" placeholder="留空即不修改密码">
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px">
              <div class="field" style="margin-bottom:0">
                <label>角色 <span v-if="isSelf(u)" class="tip">不能修改自己的角色</span></label>
                <select v-model="editForm.role" class="select" :disabled="isSelf(u)">
                  <option value="dept">部门账号</option>
                  <option value="super">超级管理员</option>
                </select>
              </div>
              <div v-if="editForm.role === 'dept'" class="field" style="margin-bottom:0">
                <label>所属部门</label>
                <select v-model="editForm.dept" class="select">
                  <option value="" disabled>选择所属部门</option>
                  <option v-for="d in departments" :key="d.key" :value="d.key">{{ d.name }}</option>
                </select>
              </div>
            </div>
            <button class="btn btn-sm" style="margin-top:12px" :disabled="userBusy" @click="saveUser(u)">保存修改</button>
          </div>
        </div>
      </div>

      <!-- 公告设置（仅 super） -->
      <div v-if="isSuper && showAnnouncement" class="card">
        <div style="font-weight:700; font-size:15px; margin-bottom:12px">📢 公告设置</div>
        <div v-if="announcementError" class="alert alert-err">{{ announcementError }}</div>
        <div v-if="announcementOk" class="alert alert-ok">{{ announcementOk }}</div>
        <div class="field">
          <label>首页公告 <span class="tip">最多 300 字，留空则首页不显示公告横幅</span></label>
          <textarea v-model="announcementEdit" class="textarea" maxlength="300" placeholder="如：2026 招新截止 9 月 30 日，请尽快投递" />
        </div>
        <div style="font-size:12.5px; color:var(--muted); margin-bottom:12px">
          当前线上公告：{{ announcement || '（未设置）' }}
        </div>
        <button class="btn btn-sm" :disabled="announcementBusy" @click="saveAnnouncement">
          {{ announcementBusy ? '保存中…' : '保存公告' }}
        </button>
      </div>

      <!-- 筛选栏 -->
      <div class="card" style="padding:14px">
        <!-- 部门标签：仅 super 显示；部门账号本身已被服务端限定在本部门 -->
        <div v-if="isSuper" class="tabs" style="margin-bottom:12px">
          <button v-for="t in deptTabs" :key="t.key || 'all'" class="tab" :class="{ active: deptFilter === t.key }" @click="switchDept(t.key)">
            {{ t.name }}<span class="num">{{ t.total }}</span>
          </button>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center">
          <button v-for="t in statusTabs" :key="t.key" class="tab" :class="{ active: statusFilter === t.key }" @click="switchStatus(t.key)">
            {{ t.label }}<span class="num">{{ tabCount(t.key) }}</span>
          </button>
          <div style="flex:1" />
          <input v-model="search" class="input" style="width:180px; padding:7px 12px" placeholder="搜姓名/学号/投递码" @keyup.enter="doSearch">
          <button class="btn-sm btn btn-ghost" @click="doSearch">搜索</button>
          <a class="btn-sm btn btn-ghost" href="/api/admin/export" download style="text-decoration:none">导出 CSV</a>
        </div>
      </div>

      <div v-if="listError" class="alert alert-err">{{ listError }}</div>

      <!-- 列表 -->
      <div class="card" style="padding:0; overflow:hidden">
        <div v-if="listLoading && !rows.length" class="empty">加载中…</div>
        <div v-else-if="!rows.length" class="empty">暂无投递记录</div>
        <div v-for="r in rows" :key="r.id"
          style="display:flex; align-items:center; gap:12px; padding:14px 18px; border-bottom:1px solid var(--line); cursor:pointer"
          @click="openDetail(r)">
          <div style="flex:1; min-width:0">
            <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap">
              <b style="font-size:14.5px">{{ r.name }}</b>
              <span style="font-size:12.5px; color:var(--muted)">{{ r.student_id }}</span>
              <span class="badge" style="background:var(--bg); color:var(--muted2)">{{ deptName(r.dept) || '未知部门' }}</span>
            </div>
            <div style="font-size:12px; color:var(--muted); margin-top:2px">
              {{ r.code }} · {{ r.created_at }}{{ hasWork(r) ? ' · 有作品' : '' }}
            </div>
          </div>
          <span class="badge" :class="r.status">{{ statusText[r.status] }}</span>
        </div>
      </div>

      <!-- 分页 -->
      <div v-if="total > size" style="text-align:center; margin-top:14px">
        <button class="btn-sm btn btn-ghost" :disabled="page <= 1" @click="turn(-1)">上一页</button>
        <span style="margin:0 12px; font-size:13px; color:var(--muted)">{{ page }} / {{ pageCount }}</span>
        <button class="btn-sm btn btn-ghost" :disabled="page >= pageCount" @click="turn(1)">下一页</button>
      </div>

      <!-- 详情弹层 -->
      <div v-if="detail" style="position:fixed; inset:0; background:rgba(15,23,42,.5); z-index:100; display:flex; align-items:flex-end; justify-content:center" @click.self="detail = null">
        <div style="background:#fff; border-radius:20px 20px 0 0; width:100%; max-width:720px; max-height:88vh; overflow-y:auto; padding:22px 20px 32px">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px">
            <b style="font-size:17px">{{ detail.name }} <span style="font-size:13px; color:var(--muted); font-weight:400">{{ detail.code }}</span></b>
            <span class="badge" :class="detail.status">{{ statusText[detail.status] }}</span>
          </div>
          <table style="width:100%; font-size:13.5px; margin-bottom:14px">
            <tbody>
              <tr><td style="color:var(--muted); width:80px; padding:4px 0">学号</td><td>{{ detail.student_id }}</td></tr>
              <tr><td style="color:var(--muted); padding:4px 0">QQ</td><td>{{ detail.qq }}</td></tr>
              <tr><td style="color:var(--muted); padding:4px 0">手机</td><td>{{ detail.phone || '未填' }}</td></tr>
              <tr><td style="color:var(--muted); padding:4px 0">部门</td><td>{{ deptName(detail.dept) || '未知部门' }}</td></tr>
              <tr><td style="color:var(--muted); padding:4px 0">时间</td><td>{{ detail.created_at }}</td></tr>
            </tbody>
          </table>

          <div v-if="detail.intro" class="card" style="padding:12px 14px; font-size:13.5px; background:var(--bg); margin:0 0 12px">
            💬 {{ detail.intro }}
          </div>

          <div v-if="detailError" class="alert alert-err">{{ detailError }}</div>
          <div v-if="reassignWarning" class="alert" style="background:#FFFBEB; color:#A05A00; border:1px solid #FDE68A">
            ⚠️ {{ reassignWarning }}
          </div>

          <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px">
            <a v-if="detail.resume_path" class="btn-sm btn" :href="`/api/admin/files/${detail.resume_path}`" target="_blank" style="text-decoration:none">
              📄 查看 {{ detail.resume_name || '简历' }}
            </a>
            <!-- 文秘部不显示作品栏 -->
            <template v-if="detailShowsWork">
              <a v-if="detail.work_url" class="btn-sm btn btn-info" :href="detail.work_url" target="_blank" style="text-decoration:none">🔗 作品链接</a>
              <a v-if="detail.work_path" class="btn-sm btn btn-info" :href="`/api/admin/files/${detail.work_path}`" target="_blank" style="text-decoration:none">📎 作品附件</a>
            </template>
          </div>

          <div class="field">
            <label>留言给投递人 <span class="tip">展示在查询页</span></label>
            <textarea v-model="noteEdit" class="textarea" maxlength="200" placeholder="如：作品完成度不错，欢迎加入！" />
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px">
            <button class="btn btn-ok" :disabled="detailBusy" @click="saveNoteAndAccept">✓ 留言并免试通过</button>
            <button class="btn" :disabled="detailBusy" @click="saveNote">保存留言</button>
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; margin-top:10px">
            <button class="btn-sm btn btn-ghost" :disabled="detailBusy" @click="setStatus('reviewing')">标为审核中</button>
            <button class="btn-sm btn btn-warn" :disabled="detailBusy" @click="setStatus('pending')">重置待审</button>
            <button class="btn-sm btn btn-danger" :disabled="detailBusy" @click="setStatus('rejected')">标为未通过</button>
          </div>

          <!-- 改派部门：仅超级管理员 -->
          <div v-if="isSuper" style="margin-top:18px; padding-top:16px; border-top:1px solid var(--line)">
            <div style="font-weight:700; font-size:14px; margin-bottom:8px">改派部门 <span class="tip" style="font-size:12px; color:var(--muted); font-weight:400">仅超级管理员</span></div>
            <div style="display:flex; gap:10px; flex-wrap:wrap">
              <select v-model="reassignTo" class="select" style="flex:1; min-width:160px">
                <option value="" disabled>选择目标部门</option>
                <option v-for="d in departments" :key="d.key" :value="d.key">{{ d.name }}</option>
              </select>
              <button class="btn btn-sm" :disabled="detailBusy || !reassignTo || reassignTo === detail.dept" @click="doReassign">确认改派</button>
            </div>
            <div style="font-size:12px; color:var(--muted); margin-top:6px">
              当前部门：{{ deptName(detail.dept) || '未知部门' }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
