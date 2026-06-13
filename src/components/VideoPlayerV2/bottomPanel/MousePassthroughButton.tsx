import configStore, { saveConfig, updateConfig } from '@root/store/config'
import { t } from '@root/utils/i18n'
import { observer } from 'mobx-react'
import { FC, MouseEvent } from 'react'
import ActionButton from './ActionButton'

const MousePassthroughIcon: FC<{ active?: boolean }> = ({ active }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ opacity: active ? 1 : 0.5 }}
  >
    <path d="M4 4l16 16" />
    <path d="M8 4l4 14 2-5 5-2L8 4z" />
  </svg>
)

const MousePassthroughButton: FC = observer(() => {
  const active = configStore.mousePassthrough

  const handleToggle = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()

    const nextMousePassthrough = !configStore.mousePassthrough
    updateConfig({ mousePassthrough: nextMousePassthrough })
    if (!nextMousePassthrough) {
      saveConfig()
    }
  }

  return (
    <ActionButton
      onClick={handleToggle}
      isUnActive={!active}
      title={t('settingPanel.mousePassthrough' as any)}
    >
      <MousePassthroughIcon active={active} />
    </ActionButton>
  )
})

export default MousePassthroughButton
