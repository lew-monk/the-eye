import path from 'node:path'

// Biome 2 resolves its project root from the working directory, so it must
// run from inside apps/eye-web-app. Rebase staged paths and run it there.
const APP_DIR = 'apps/eye-web-app'

function biomeCheck(files) {
  const rel = files.map((f) => path.relative(APP_DIR, f)).filter((f) => !f.startsWith('..') && f !== '')
  if (rel.length === 0) return []
  const quoted = rel.map((f) => `"${f}"`).join(' ')
  return `cd ${APP_DIR} && bunx biome check --write ${quoted}`
}

export default {
  [`${APP_DIR}/**/*.{ts,tsx,js,jsx,json}`]: biomeCheck,
}
