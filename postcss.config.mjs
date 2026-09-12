import tailwindcss from '@tailwindcss/postcss'
import remToPx from './scripts/plugin/postcssRemToPx.mjs'

export default {
  plugins: [tailwindcss(), remToPx()],
}
