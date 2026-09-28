import { requireSessionSecret } from '../infrastructure/config'

// Nitro loads server plugins while creating the app, before it accepts requests.
// Validate here because route handlers are lazy-loaded and auth.ts alone is not
// guaranteed to execute before the HTTP listener starts.
export default defineNitroPlugin(() => {
  requireSessionSecret()
})
