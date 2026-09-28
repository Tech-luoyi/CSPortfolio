import { healthApp } from '../infrastructure/bootstrap'

export default defineEventHandler(async () => {
  const result = await healthApp.ready()
  if (!result) throw createError({ statusCode: 503, statusMessage: 'Service Unavailable' })
  return result
})
