import { PushpinOutlined } from '@ant-design/icons'
import configStore, { updateConfig } from '@root/store/config'
import { isDocPIP } from '@root/utils'
import { useMemoizedFn } from 'ahooks'
import { observer } from 'mobx-react'
import { FC, useContext } from 'react'
import { t } from '@root/utils/i18n'
import vpContext from '../context'
import ActionButton from './ActionButton'

const AutoDockButton: FC = observer(() => {
  const { videoPlayerRef } = useContext(vpContext)
  const active = configStore.autoDockPIP

  const toggleAutoDock = useMemoizedFn(() => {
    const autoDockPIP = !configStore.autoDockPIP
    updateConfig({
      autoDockPIP,
      ...(autoDockPIP ? { mousePassthrough: false } : {}),
    })
  })

  if (!isDocPIP(videoPlayerRef.current)) return
  return (
    <ActionButton
      aria-pressed={active}
      isUnActive={!active}
      onClick={toggleAutoDock}
      title={t('settingPanel.autoDockPIP')}
    >
      <PushpinOutlined className="block" />
    </ActionButton>
  )
})

export default AutoDockButton
