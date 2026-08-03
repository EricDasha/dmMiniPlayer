import WebextEvent from '@root/shared/webextEvent'
import { getDocPIPBorderSize } from '@root/utils/docPIP'
import { useEffect, useState } from 'react'
import { sendMessage } from 'webext-bridge/content-script'
import { t } from '@root/utils/i18n'

const MIN_PIP_WIDTH = 240
const MIN_PIP_HEIGHT = 120

const getPIPWindow = () => window.documentPictureInPicture?.window

const clampDimension = (value: number, min: number) =>
  Math.max(min, Math.round(Number.isFinite(value) ? value : min))

const PIPWindowSettings = () => {
  const [width, setWidth] = useState(0)
  const [height, setHeight] = useState(0)
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    let observedWindow: Window | undefined

    const detachWindow = () => {
      observedWindow?.removeEventListener('resize', syncResolution)
      observedWindow?.removeEventListener('pagehide', detachWindow)
      observedWindow = undefined
      setIsOpen(false)
    }

    const syncResolution = () => {
      const pipWindow = getPIPWindow()
      if (!pipWindow || pipWindow.closed) {
        detachWindow()
        return
      }

      if (observedWindow !== pipWindow) {
        detachWindow()
        observedWindow = pipWindow
        observedWindow.addEventListener('resize', syncResolution)
        observedWindow.addEventListener('pagehide', detachWindow)
      }

      setIsOpen(true)
      setWidth(pipWindow.innerWidth)
      setHeight(pipWindow.innerHeight)
    }

    syncResolution()
    const timer = setInterval(syncResolution, 500)
    return () => {
      clearInterval(timer)
      detachWindow()
    }
  }, [])

  const applyResolution = async () => {
    const pipWindow = getPIPWindow()
    if (!pipWindow || pipWindow.closed) return

    const nextWidth = clampDimension(width, MIN_PIP_WIDTH)
    const nextHeight = clampDimension(height, MIN_PIP_HEIGHT)
    const [borderX, borderY] = getDocPIPBorderSize(pipWindow)
    await sendMessage(WebextEvent.resizeDocPIP, {
      docPIPWidth: pipWindow.innerWidth,
      width: nextWidth + borderX,
      height: nextHeight + borderY,
    })
  }

  const inputStyle = {
    width: '82px',
    minWidth: 0,
    padding: '4px 6px',
    border: '1px solid #bbb',
    borderRadius: '4px',
    background: '#fff',
    color: '#222',
  } as const

  return (
    <div
      style={{
        display: 'flex',
        gap: '6px',
        alignItems: 'center',
        flexWrap: 'wrap',
      }}
    >
      <input
        aria-label="PIP width"
        type="number"
        min={MIN_PIP_WIDTH}
        value={width || ''}
        disabled={!isOpen}
        onChange={(event) => setWidth(Number(event.currentTarget.value))}
        style={inputStyle}
      />
      <span>×</span>
      <input
        aria-label="PIP height"
        type="number"
        min={MIN_PIP_HEIGHT}
        value={height || ''}
        disabled={!isOpen}
        onChange={(event) => setHeight(Number(event.currentTarget.value))}
        style={inputStyle}
      />
      <button
        type="button"
        disabled={!isOpen}
        onClick={applyResolution}
        style={{
          padding: '4px 10px',
          border: '1px solid #bbb',
          borderRadius: '4px',
          cursor: isOpen ? 'pointer' : 'not-allowed',
          opacity: isOpen ? 1 : 0.55,
        }}
      >
        {t('settingPanel.applyPIPResolution')}
      </button>
      {!isOpen && (
        <span style={{ opacity: 0.65 }}>
          {t('settingPanel.pipWindowNotOpen')}
        </span>
      )}
    </div>
  )
}

export default PIPWindowSettings
