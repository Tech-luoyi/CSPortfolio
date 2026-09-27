<script setup lang="ts">
// 投递页 —— 无锡学院计算机协会 招新简历作品投递
import { useDepartments, apiErrorMessage } from '~/composables/useDepartments'

useHead({ title: '简历作品投递 · 无锡学院计算机协会' })

// 部门字典来自服务端（不硬编码）；作品是否必填由字典里的 work 策略决定
const { departments, deptPolicy } = useDepartments()

const form = reactive({
  name: '', student_id: '', qq: '', phone: '', dept: '', work_url: '', intro: ''
})
const resumeFile = ref<File | null>(null)
const workFile = ref<File | null>(null)
const workInput = ref<HTMLInputElement | null>(null)
const submitting = ref(false)
const error = ref('')
const isConflict = ref(false)
const successCode = ref('')
const copied = ref(false)
const MAX_RESUME_BYTES = 25 * 1024 * 1024
const MAX_WORK_BYTES = 1024 * 1024 * 1024

const selectedPolicy = computed(() => deptPolicy(form.dept))
// required = 作品必填、展示作品区块；hidden = 整个作品区块隐藏
const workRequired = computed(() => selectedPolicy.value?.work === 'required')
const workHidden = computed(() => !!form.dept && selectedPolicy.value?.work === 'hidden')

// 切到「不接收作品」的部门时，已填的作品链接/附件必须一并清掉：
// 服务端对 hidden 部门收到作品字段会直接 400 拒收，留着就是必失败。
watch(() => form.dept, () => {
  if (workRequired.value) return
  form.work_url = ''
  workFile.value = null
  if (workInput.value) workInput.value.value = ''
})

function onResume(e: any) {
  const f: File | null = e.target.files?.[0] || null
  if (f && f.size > MAX_RESUME_BYTES) {
    error.value = '简历文件超过 25MB，请压缩后再上传'
    resumeFile.value = null
    e.target.value = ''
    return
  }
  error.value = ''
  isConflict.value = false
  resumeFile.value = f
}

function onWork(e: any) {
  const f: File | null = e.target.files?.[0] || null
  if (f && f.size > MAX_WORK_BYTES) {
    error.value = '作品文件超过 1GB，请压缩后再上传'
    workFile.value = null
    e.target.value = ''
    return
  }
  error.value = ''
  isConflict.value = false
  workFile.value = f
}

const { data: ann } = await useFetch('/api/announcement')

async function submit() {
  error.value = ''
  isConflict.value = false
  if (!form.name.trim()) { error.value = '请填写姓名'; return }
  if (!/^[A-Za-z0-9]{6,20}$/.test(form.student_id.trim())) { error.value = '学号需为 6-20 位字母或数字'; return }
  if (!/^[1-9][0-9]{4,11}$/.test(form.qq.trim())) { error.value = 'QQ 号需为 5-12 位数字'; return }
  if (form.phone.trim() && !/^1[0-9]{10}$/.test(form.phone.trim())) { error.value = '手机号格式不正确（11 位，1 开头）'; return }
  if (!form.dept) { error.value = '请选择意向部门'; return }
  const resume = resumeFile.value
  if (!resume) { error.value = '请上传简历文件（PDF 或图片）'; return }
  if (form.work_url.trim() && !/^https?:\/\/.+/i.test(form.work_url.trim())) {
    error.value = '作品链接须以 http:// 或 https:// 开头'; return
  }
  if (workRequired.value && !form.work_url.trim() && !workFile.value) {
    error.value = `${selectedPolicy.value?.name || '该部门'}需要提交作品：作品链接或作品附件至少一个`
    return
  }

  submitting.value = true
  try {
    const fd = new FormData()
    // multipart 字段名是后端约定的，逐一显式写入（不用 Object.entries，避免误带字段）
    fd.append('name', form.name.trim())
    fd.append('student_id', form.student_id.trim())
    fd.append('qq', form.qq.trim())
    fd.append('phone', form.phone.trim())
    fd.append('dept', form.dept)
    fd.append('intro', form.intro)
    fd.append('work_url', workRequired.value ? form.work_url.trim() : '')
    fd.append('resume', resume)
    // 仅作品必填部门才提交 work；文秘部提交会被服务端拒收
    if (workRequired.value && workFile.value) fd.append('work', workFile.value)

    const res: any = await $fetch('/api/submissions', { method: 'POST', body: fd })
    successCode.value = res?.code || ''
    if (import.meta.client) window.scrollTo({ top: 0, behavior: 'smooth' })
  } catch (e: any) {
    // 409（学号已投递）/ 415 / 413 / 400 的业务提示都来自服务端，必须原样透出，不能吞掉
    error.value = apiErrorMessage(e, '提交失败，请稍后再试')
    isConflict.value = e?.status === 409 || e?.data?.statusCode === 409
  } finally {
    submitting.value = false
  }
}

async function copyCode() {
  if (!import.meta.client || !successCode.value) return
  try {
    await navigator.clipboard.writeText(successCode.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch { /* 剪贴板不可用时忽略，用户仍可手动截图 */ }
}
</script>

<template>
  <div>
    <!-- 顶部介绍 -->
    <div class="card" style="text-align:center; padding:28px 20px">
      <div style="font-size:21px; font-weight:800; color:var(--primary)">无锡学院计算机协会</div>
      <div style="font-size:13px; color:var(--muted); margin-top:4px">WUXI UNIVERSITY COMPUTER ASSOCIATION</div>
      <div style="margin:14px auto 0; max-width:480px; font-size:13.5px; color:var(--muted2)">
        2026 招新通道 —— 在这里投递你的<b style="color:var(--primary)">简历和作品</b>，
        通过审核即可<b style="color:var(--ok)">免试进入无锡学院计算机协会</b>。
      </div>
    </div>

    <!-- 公告 -->
    <div v-if="ann?.announcement" class="announcement">
      <span class="icon">📢</span>
      <span>{{ ann.announcement }}</span>
    </div>

    <!-- 提交成功 -->
    <div v-if="successCode" class="card">
      <div class="code-box">
        <div style="font-size:13px; opacity:.85">🎉 投递成功！这是你的专属投递码，请截图保存</div>
        <div class="big">{{ successCode }}</div>
        <div style="font-size:12.5px; opacity:.75">凭学号或投递码可在「查进度」页面查看审核结果</div>
        <button
          class="btn-sm"
          style="margin-top:14px; background:rgba(255,255,255,.16); color:#fff; border:1px solid rgba(255,255,255,.32); border-radius:10px; padding:7px 14px; font-size:13px; font-weight:600; cursor:pointer; font-family:inherit"
          @click="copyCode">{{ copied ? '已复制 ✓' : '复制投递码' }}</button>
      </div>
      <div style="text-align:center">
        <NuxtLink to="/status" style="color:var(--primary); font-size:13.5px; font-weight:600">→ 去查询审核进度</NuxtLink>
      </div>
    </div>

    <!-- 投递表单 -->
    <div v-else class="card">
      <div v-if="error" class="alert alert-err">
        {{ error }}
        <div v-if="isConflict" style="margin-top:6px; font-size:12.5px">
          需要找回已有投递码时，请到
          <NuxtLink to="/status" style="font-weight:600; text-decoration:underline">查询进度</NuxtLink>
          页面用学号查询。
        </div>
      </div>

      <div style="font-weight:700; margin-bottom:16px; font-size:16px">📝 填写投递信息</div>

      <div class="field">
        <label>姓名 <span class="tip">*必填</span></label>
        <input v-model="form.name" class="input" placeholder="你的真实姓名" maxlength="20">
      </div>

      <div class="field">
        <label>学号 <span class="tip">*必填，6-20 位字母或数字，每个学号只能投递一次</span></label>
        <input v-model="form.student_id" class="input" placeholder="如 2024123456" maxlength="20">
      </div>

      <div class="field">
        <label>QQ 号 <span class="tip">*必填，用于联系你</span></label>
        <input v-model="form.qq" class="input" placeholder="用于拉群和通知结果" maxlength="12">
      </div>

      <div class="field">
        <label>手机号 <span class="tip">选填</span></label>
        <input v-model="form.phone" class="input" placeholder="选填" maxlength="11">
      </div>

      <div class="field">
        <label>意向部门 <span class="tip">*必填，一名同学只能投递一个部门</span></label>
        <select v-model="form.dept" class="select">
          <option value="" disabled>选择你意向的部门</option>
          <option v-for="d in departments" :key="d.key" :value="d.key">{{ d.name }}</option>
        </select>
        <div v-if="!departments.length" style="font-size:12px; color:var(--danger); margin-top:6px">
          部门列表加载失败，请刷新页面重试
        </div>
      </div>

      <div class="field">
        <label>简历文件 <span class="tip">*必填，PDF / JPG / PNG，不超过 25MB</span></label>
        <input type="file" class="input" accept=".pdf,.jpg,.jpeg,.png" @change="onResume">
      </div>

      <!-- 作品区块：仅「作品必填」部门显示 -->
      <template v-if="workRequired">
        <div class="field">
          <label>作品链接 <span class="tip">*必填（与作品附件至少一个），GitHub / 博客 / 网盘等</span></label>
          <input v-model="form.work_url" class="input" placeholder="https://github.com/你的用户名">
        </div>

        <div class="field">
          <label>作品附件 <span class="tip">*必填（与作品链接至少一个），PDF / 图片 / ZIP，不超过 1GB</span></label>
          <input ref="workInput" type="file" class="input" accept=".pdf,.jpg,.jpeg,.png,.zip" @change="onWork">
        </div>
      </template>

      <div
        v-else-if="workHidden"
        class="alert"
        style="background:var(--bg); color:var(--muted2); border:1px solid var(--line)"
      >
        {{ selectedPolicy?.name }}无需提交作品，只需上传简历即可。
      </div>

      <div
        v-else
        class="alert"
        style="background:var(--bg); color:var(--muted2); border:1px solid var(--line)"
      >
        选择意向部门后，这里会显示该部门的作品要求。
      </div>

      <div class="field">
        <label>一句话自荐 <span class="tip">选填，最多 200 字</span></label>
        <textarea v-model="form.intro" class="textarea" maxlength="200" placeholder="让协会快速认识你：做过什么、会什么、想做什么" />
      </div>

      <button class="btn" :disabled="submitting || !departments.length" @click="submit">
        {{ submitting ? '正在提交…' : '提交投递' }}
      </button>
      <div style="text-align:center; font-size:12px; color:var(--muted); margin-top:12px">
        提交即表示同意无锡学院计算机协会在招新审核范围内使用上述信息
      </div>
    </div>
  </div>
</template>
