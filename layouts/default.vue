<template>
  <div>
    <header class="appbar">
      <div class="appbar-inner">
        <NuxtLink to="/" style="text-decoration:none">
          <div class="appbar-brand">
            <div class="logo">计协</div>
            <div>
              <div style="font-size:14.5px; line-height:1.3">无锡学院计算机协会</div>
              <div style="font-size:11px; color:var(--muted); font-weight:400; line-height:1.3">简历作品投递系统</div>
            </div>
          </div>
        </NuxtLink>
        <nav class="appbar-nav">
          <NuxtLink to="/">投递</NuxtLink>
          <NuxtLink to="/status">查询进度</NuxtLink>
          <NuxtLink to="/admin">管理后台</NuxtLink>
        </nav>
      </div>
    </header>
    <div class="page">
      <slot />
    </div>
    <footer class="footer">
      <b>无锡学院计算机协会</b><br>
      简历作品投递系统 · 通过审核可免试入会<br>
      © {{ new Date().getFullYear() }} 无锡学院计算机协会 · Nuxt.js 出品
    </footer>
  </div>
</template>
