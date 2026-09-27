<script setup lang="ts">
// 查询页 —— 凭学号/投递码查看无锡学院计算机协会审核进度 + 自助撤回
import { useDepartments, apiErrorMessage } from '~/composables/useDepartments'

useHead({ title: '查进度 · 无锡学院计算机协会' })

// 查询结果里的 dept 是英文 key，必须用服务端字典映射成中文名
const { deptName } = useDepartments()

const queryForm = reactive({ code: '', student_id: '' })
const loading = ref(false)
const error = ref('')
const result = ref<any>(null)

const statusText: Record<string, string> = {
  pending: '待审核', reviewing: '审核中', accepted: '免试通过 🎉', rejected: '未通过'
}

// 撤回：后端要求「投递码 + 学号」双因子匹配同一行
const withdraw = reactive({ code: '', student_id: '' })
const withdrawing = ref(false)
const withdrawError = ref('')
const withdrawOk = ref('')

// 已进入审核流程（reviewing / accepted）由后端硬拒，前端提前禁用，不让用户白跑一次 409
const withdrawLocked = computed(() =>
  !!result.value && (result.value.status === 'reviewing' || result.value.status === 'accepted')
)

async function query() {
  error.value = ''
  result.value = null
  withdrawError.value = ''
  withdrawOk.value = ''
  const code = queryForm.code.trim()
  const studentId = queryForm.student_id.trim()
  if (!/^JX-\d{4}-\d{1,20}$/i.test(code) || !/^[A-Za-z0-9]{6,20}$/.test(studentId)) {
    error.value = '请输入正确的投递码和学号'
    return
  }
  loading.value = true
  try {
    const res: any = await $fetch('/api/submissions/query', {
      method: 'POST',
      body: { code, student_id: studentId }
    })
    result.value = res?.data || null
    // 预填撤回表单，减少手输错误
    withdraw.code = result.value?.code || code
    withdraw.student_id = studentId
  } catch (e: any) {
    error.value = apiErrorMessage(e, '查询失败，请稍后再试')
  } finally {
    loading.value = false
  }
}

async function doWithdraw() {
  withdrawError.value = ''
  withdrawOk.value = ''
  const code = withdraw.code.trim()
  const sid = withdraw.student_id.trim()
  if (!code || !sid) { withdrawError.value = '请填写投递码与学号（两者须与投递时一致）'; return }
  if (!confirm('确认撤回这次投递吗？撤回后旧投递码立即作废，需要重新投递。')) return

  withdrawing.value = true
  try {
    const res: any = await $fetch('/api/submissions/withdraw', { method: 'POST', body: { code, student_id: sid } })
    result.value = null
    withdrawOk.value = res?.message || '已撤回。旧投递码已作废，重新投递会得到新码'
  } catch (e: any) {
    withdrawError.value = apiErrorMessage(e, '撤回失败，请核对投递码与学号')
  } finally {
    withdrawing.value = false
  }
}
</script>

<template>
  <div>
    <div class="card">
      <div style="font-weight:700; margin-bottom:6px; font-size:16px">🔍 查询审核进度</div>
      <div style="font-size:13px; color:var(--muted); margin-bottom:16px">
        输入投递码和投递时填写的学号，查看无锡学院计算机协会的审核结果
      </div>
      <div class="field">
        <input v-model="queryForm.code" class="input" placeholder="投递码，如 JX-2026-0001">
      </div>
      <div class="field">
        <input v-model="queryForm.student_id" class="input" placeholder="投递时填写的学号" @keyup.enter="query">
      </div>
      <button class="btn" :disabled="loading" @click="query">{{ loading ? '查询中…' : '查 询' }}</button>
    </div>

    <!-- 撤回成功（结果卡片已清空，提示要独立显示） -->
    <div v-if="withdrawOk" class="alert alert-ok">
      {{ withdrawOk }}<br>
      <NuxtLink to="/" style="font-weight:600; text-decoration:underline; color:inherit">→ 重新投递</NuxtLink>
    </div>

    <div v-if="error" class="alert alert-err">{{ error }}</div>

    <div v-if="result" class="card">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px">
        <div>
          <div style="font-size:13px; color:var(--muted)">投递码</div>
          <div style="font-weight:800; font-size:17px; font-family:Consolas,monospace">{{ result.code }}</div>
        </div>
        <span class="badge" :class="result.status">{{ statusText[result.status] }}</span>
      </div>
      <table style="width:100%; font-size:13.5px">
        <tbody>
          <tr><td style="color:var(--muted); width:80px; padding:5px 0">姓名</td><td>{{ result.name }}</td></tr>
          <tr><td style="color:var(--muted); padding:5px 0">意向部门</td><td>{{ deptName(result.dept) || '未填写' }}</td></tr>
          <tr><td style="color:var(--muted); padding:5px 0">投递时间</td><td>{{ result.created_at }}</td></tr>
        </tbody>
      </table>

      <div v-if="result.status === 'accepted'" class="alert alert-ok" style="margin-top:14px">
        恭喜！你的简历/作品已通过无锡学院计算机协会审核，<b>免除面试直接录取</b>。请留意 QQ 通知，协会会尽快联系你！
      </div>
      <div v-else-if="result.status === 'reviewing'" class="alert" style="background:#EFF6FF; color:#1D4ED8; border:1px solid #BFDBFE; margin-top:14px">
        简历/作品正在由无锡学院计算机协会评审中，请耐心等待～
      </div>
      <div v-else-if="result.status === 'rejected'" class="alert alert-err" style="margin-top:14px">
        很遗憾这次未能通过。{{ result.admin_note ? '协会留言：' + result.admin_note : '' }} 欢迎下次招新再来！
      </div>
      <div v-else class="alert" style="background:#FFFBEB; color:#A05A00; border:1px solid #FDE68A; margin-top:14px">
        已收到你的投递，等待无锡学院计算机协会审核，请耐心等待～
      </div>

      <div v-if="result.admin_note && result.status !== 'rejected'" style="margin-top:10px; font-size:13px; color:var(--muted2)">
        📩 协会留言：{{ result.admin_note }}
      </div>

      <!-- 撤回 -->
      <div style="margin-top:18px; padding-top:16px; border-top:1px solid var(--line)">
        <div style="font-weight:700; font-size:14px; margin-bottom:6px">撤回投递</div>

        <div v-if="withdrawLocked" class="alert" style="background:var(--bg); color:var(--muted2); border:1px solid var(--line); margin:0">
          该投递已进入审核流程，无法自助撤回，请联系部长。
        </div>

        <template v-else>
          <div style="font-size:12.5px; color:var(--muted); margin-bottom:12px">
            需同时填写投递码与学号（两者须与投递时一致）。撤回后旧投递码作废，可重新投递并获得新码。
          </div>
          <div v-if="withdrawError" class="alert alert-err">{{ withdrawError }}</div>
          <div class="field">
            <label>投递码</label>
            <input v-model="withdraw.code" class="input" placeholder="如 JX-2026-0001">
          </div>
          <div class="field">
            <label>学号</label>
            <input v-model="withdraw.student_id" class="input" placeholder="投递时填写的学号">
          </div>
          <button class="btn btn-danger" :disabled="withdrawing" @click="doWithdraw">
            {{ withdrawing ? '正在撤回…' : '撤回本次投递' }}
          </button>
        </template>
      </div>
    </div>
  </div>
</template>
