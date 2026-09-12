import configStore, { saveConfig, updateConfig } from '@root/store/config'
import { t } from '@root/utils/i18n'
import { observer } from 'mobx-react'
import { FC, MouseEvent } from 'react'
import ActionButton from './ActionButton'

const LockRatio16by9Button: FC = observer(() => {
  const active = configStore.lockPIPRatio16by9

  const handleToggle = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()

    const next = !configStore.lockPIPRatio16by9
    updateConfig({
      lockPIPRatio16by9: next,
      lockPIPAspectRatio: next,
    })
    saveConfig()
  }

  // 滑块旁边的开关：开启后让 docPIP 窗口固定 16:9，之后任意拖动/缩放都会被校正回 16:9
  return (
    <ActionButton
      onClick={handleToggle}
      isUnActive={!active}
      aria-pressed={active}
      title={t('settingPanel.lockPIPRatio16by9')}
    >
      <span
        className="text-[10px] font-bold leading-[18px] tracking-wide"
        style={{ opacity: active ? 1 : 0.5 }}
      >
        16:9
      </span>
    </ActionButton>
  )
})

export default LockRatio16by9Button