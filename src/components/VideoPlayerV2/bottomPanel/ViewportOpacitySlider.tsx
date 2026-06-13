import configStore, { saveConfig, updateConfig } from '@root/store/config'
import { t } from '@root/utils/i18n'
import { observer } from 'mobx-react'
import { CSSProperties, FC, MouseEvent, WheelEvent } from 'react'

const OpacityIcon: FC = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 2v20" />
    <path d="M12 2a8 8 0 0 0 0 20" />
    <path d="M12 2a8 8 0 0 1 0 20" opacity="0.45" />
  </svg>
)

const ViewportOpacitySlider: FC = observer(() => {
  const opacity = Math.max(5, Math.min(100, configStore.viewportOpacity ?? 100))

  const handleChange = (percent: number) => {
    const nextOpacity = Math.max(5, Math.min(100, Math.round(percent)))
    updateConfig({ viewportOpacity: nextOpacity })
    saveConfig()
  }

  const stopEvent = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation()
  }

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()

    const step = event.ctrlKey ? 10 : event.shiftKey ? 1 : 5
    const direction = event.deltaY < 0 ? 1 : -1
    handleChange(opacity + direction * step)
  }

  return (
    <div
      className="dmmp-keep-pointer f-i-center gap-2 h-[26px] px-2 rounded-[4px] bg-[#ffffff12] hover:bg-[#ffffff1f] transition-colors"
      title={`${t('settingPanel.viewportOpacity' as any)}: ${opacity}%`}
      onClick={stopEvent}
      onMouseDown={stopEvent}
      onWheel={handleWheel}
    >
      <OpacityIcon />
      <input
        className="viewport-opacity-range w-[86px] h-[14px] cursor-pointer"
        type="range"
        min={5}
        max={100}
        step={1}
        value={opacity}
        onChange={(event) => handleChange(Number(event.target.value))}
        style={
          {
            '--opacity-percent': `${((opacity - 5) / 95) * 100}%`,
          } as CSSProperties
        }
      />
      <span className="min-w-[42px] text-right text-[12px] opacity-80 whitespace-nowrap tabular-nums">
        {opacity}%
      </span>
      <style>
        {`.viewport-opacity-range {
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
}
.viewport-opacity-range::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--color-main) 0 var(--opacity-percent), rgba(255,255,255,.32) var(--opacity-percent) 100%);
  transition: background 120ms linear;
}
.viewport-opacity-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  margin-top: -4px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,.85);
  background: #fff;
  box-shadow: 0 1px 4px rgba(0,0,0,.45);
  transition: transform 120ms linear;
}
.viewport-opacity-range::-moz-range-track {
  height: 4px;
  border-radius: 999px;
  background: rgba(255,255,255,.32);
}
.viewport-opacity-range::-moz-range-progress {
  height: 4px;
  border-radius: 999px;
  background: var(--color-main);
}
.viewport-opacity-range::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,.85);
  background: #fff;
  box-shadow: 0 1px 4px rgba(0,0,0,.45);
}`}
      </style>
    </div>
  )
})

export default ViewportOpacitySlider
