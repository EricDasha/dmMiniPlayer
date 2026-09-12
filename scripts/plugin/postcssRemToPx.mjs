const REM_VALUE_RE = /(-?(?:\d+\.\d+|\d+|\.\d+))rem\b/g
const SKIP_PROPS = new Set(['content', 'font-family'])

/**
 * Convert rem units in the compiled CSS to px.
 * Replaces tailwindcss-rem-to-px, which does not support Tailwind v4.
 */
export default function remToPx({ baseFontSize = 16 } = {}) {
  const replaceRem = (value) =>
    value.replace(REM_VALUE_RE, (_, n) => {
      const px = parseFloat(n) * baseFontSize
      return `${Number(px.toFixed(4))}px`
    })

  return {
    postcssPlugin: 'rem-to-px',
    Declaration(decl) {
      if (SKIP_PROPS.has(decl.prop) || !decl.value.includes('rem')) return
      decl.value = replaceRem(decl.value)
    },
    AtRule(atRule) {
      if (!atRule.params?.includes('rem')) return
      atRule.params = replaceRem(atRule.params)
    },
  }
}

remToPx.postcss = true
