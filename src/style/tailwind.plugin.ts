const DESIGN_WIDTH = 1440

type MatchUtilities = (
  utilities: Record<string, (value: string) => Record<string, string>>,
) => void

function parseBorderValue(value: string) {
  const [color, width = '1px', rounded] = value.split(',')
  return { color, width, rounded }
}

export default function tailwindPlugin({
  matchUtilities,
}: {
  matchUtilities: MatchUtilities
}) {
  matchUtilities({
    'min-font': (value) => {
      const [size, lh] = value.split(',')
      return {
        fontSize: `min(calc(${(+size / DESIGN_WIDTH) * 100}vw), calc(${size}px))`,
        lineHeight: `calc(${+lh / +size})`,
      }
    },
    min: (value) => {
      const [key, val] = value.split(',')
      return {
        [key]: `min(calc(${(+val / DESIGN_WIDTH) * 100}vw), calc(${val}px))`,
      }
    },
    wh: (value) => {
      const [width, height] = value.split(',')
      return {
        width,
        height: height || width,
      }
    },
    lgtext: (value) => {
      const [deg, from, to] = value.split(',')
      return {
        background: `-webkit-linear-gradient(${deg}deg, ${from}, ${to})`,
        '-webkit-background-clip': 'text',
        '-webkit-text-fill-color': 'transparent',
      }
    },
    bor: (value) => {
      const { color, width, rounded } = parseBorderValue(value)
      return Object.fromEntries(
        [
          ['borderWidth', width],
          ['borderColor', color],
          ['borderRadius', rounded],
        ].filter((entry) => !!entry[1]),
      )
    },
    'bor-l': (value) => {
      const { color, width, rounded } = parseBorderValue(value)
      return Object.fromEntries(
        [
          ['borderWidth', `0 0 0 ${width}`],
          ['borderColor', color],
          ['borderRadius', rounded],
        ].filter((entry) => !!entry[1]),
      )
    },
    'bor-r': (value) => {
      const { color, width, rounded } = parseBorderValue(value)
      return Object.fromEntries(
        [
          ['borderWidth', `0 ${width} 0 0`],
          ['borderColor', color],
          ['borderRadius', rounded],
        ].filter((entry) => !!entry[1]),
      )
    },
    'bor-t': (value) => {
      const { color, width, rounded } = parseBorderValue(value)
      return Object.fromEntries(
        [
          ['borderWidth', `${width} 0 0 0`],
          ['borderColor', color],
          ['borderRadius', rounded],
        ].filter((entry) => !!entry[1]),
      )
    },
    'bor-b': (value) => {
      const { color, width, rounded } = parseBorderValue(value)
      return Object.fromEntries(
        [
          ['borderWidth', `0 0 ${width} 0`],
          ['borderColor', color],
          ['borderRadius', rounded],
        ].filter((entry) => !!entry[1]),
      )
    },
  })
}
