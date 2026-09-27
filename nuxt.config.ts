export default defineNuxtConfig({
  compatibilityDate: '2024-09-01',
  devtools: { enabled: false },
  ssr: true,
  css: ['~/assets/css/main.css'],
  app: {
    head: {
      title: '无锡学院计算机协会 · 简历作品投递',
      htmlAttrs: { lang: 'zh-CN' },
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: '无锡学院计算机协会招新简历作品投递系统，通过审核可免试入会' }
      ]
    }
  },
  nitro: {
    // 简历作品等上传文件落盘目录，可通过环境变量覆盖
    storage: {
      uploads: process.env.UPLOAD_DIR ? { driver: 'fs', base: process.env.UPLOAD_DIR } : { driver: 'fs', base: './uploads' }
    }
  }
})
