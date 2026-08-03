import { NATIVE_WINDOW_HOST_INSTALL_GUIDE } from '@root/shared/nativeWindowOpacity'
import { NATIVE_HOST_MISSING_REMINDER_DISABLED } from '@root/shared/storeKey'
import WebextEvent from '@root/shared/webextEvent'
import { t } from '@root/utils/i18n'
import {
  getBrowserLocalStorage,
  setBrowserLocalStorage,
} from '@root/utils/storage'
import { useEffect, useState } from 'react'
import { sendMessage } from 'webext-bridge/content-script'

const NOTICE_ID = 'dmmp-native-host-missing-notice'

const isWindows = () => /Windows/i.test(navigator.userAgent)

const openInstallGuide = () => {
  window.open(NATIVE_WINDOW_HOST_INSTALL_GUIDE, '_blank', 'noopener,noreferrer')
}

const probeNativeHost = (force = false) =>
  sendMessage(WebextEvent.probeNativeWindowOpacity, { force }).catch(
    () => false,
  )

const createButton = (doc: Document, label: string, primary = false) => {
  const button = doc.createElement('button')
  button.type = 'button'
  button.textContent = label
  Object.assign(button.style, {
    border: primary ? '1px solid #1677ff' : '1px solid #666',
    borderRadius: '6px',
    padding: '7px 12px',
    background: primary ? '#1677ff' : '#2b2b2b',
    color: '#fff',
    cursor: 'pointer',
  })
  return button
}

export const showNativeHostMissingNotice = async (pipWindow: Window) => {
  const reminderDisabled = await getBrowserLocalStorage(
    NATIVE_HOST_MISSING_REMINDER_DISABLED,
  ).catch(() => false)
  if (
    !isWindows() ||
    reminderDisabled ||
    pipWindow.closed ||
    pipWindow.document.getElementById(NOTICE_ID)
  ) {
    return
  }

  const doc = pipWindow.document
  const overlay = doc.createElement('div')
  overlay.id = NOTICE_ID
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483647',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '18px',
    background: 'rgba(0, 0, 0, 0.62)',
    pointerEvents: 'auto',
    fontFamily: 'system-ui, sans-serif',
  })

  const panel = doc.createElement('div')
  Object.assign(panel.style, {
    width: 'min(520px, 100%)',
    maxHeight: '90vh',
    overflow: 'auto',
    border: '1px solid rgba(255,255,255,.18)',
    borderRadius: '12px',
    padding: '18px',
    background: '#1f1f1f',
    color: '#fff',
    boxShadow: '0 12px 40px rgba(0,0,0,.45)',
  })

  const title = doc.createElement('strong')
  title.textContent = t('settingPanel.nativeHostMissingTitle')
  Object.assign(title.style, { display: 'block', fontSize: '18px' })

  const consequence = doc.createElement('p')
  consequence.textContent = t('settingPanel.nativeHostMissingConsequences')
  Object.assign(consequence.style, {
    lineHeight: '1.6',
    margin: '12px 0',
    color: '#ffccc7',
  })

  const instructions = doc.createElement('p')
  instructions.textContent = t('settingPanel.nativeHostInstallSteps')
  Object.assign(instructions.style, {
    lineHeight: '1.6',
    margin: '0 0 14px',
    whiteSpace: 'pre-line',
    color: '#ddd',
  })

  const actions = doc.createElement('div')
  Object.assign(actions.style, {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  })
  const guideButton = createButton(
    doc,
    t('settingPanel.nativeHostOpenInstallGuide'),
    true,
  )
  guideButton.addEventListener('click', openInstallGuide)
  const dismissForeverButton = createButton(
    doc,
    t('settingPanel.nativeHostDoNotRemind'),
  )
  dismissForeverButton.addEventListener('click', () => {
    setBrowserLocalStorage(NATIVE_HOST_MISSING_REMINDER_DISABLED, true)
    overlay.remove()
  })
  const laterButton = createButton(doc, t('settingPanel.nativeHostRemindLater'))
  laterButton.addEventListener('click', () => overlay.remove())

  actions.append(guideButton, dismissForeverButton, laterButton)
  panel.append(title, consequence, instructions, actions)
  overlay.append(panel)
  doc.body.append(overlay)
}

type NativeHostStatus = 'checking' | 'installed' | 'missing'

const NativeHostSettings = () => {
  const [status, setStatus] = useState<NativeHostStatus>('checking')
  const [message, setMessage] = useState('')

  const refresh = async () => {
    if (!isWindows()) {
      setStatus('missing')
      setMessage(t('settingPanel.nativeHostWindowsOnly'))
      return
    }
    setStatus('checking')
    setMessage('')
    setStatus((await probeNativeHost(true)) ? 'installed' : 'missing')
  }

  useEffect(() => {
    refresh()
  }, [])

  const uninstall = async () => {
    if (!confirm(t('settingPanel.nativeHostUninstallConfirm'))) return
    setMessage(t('settingPanel.nativeHostUninstalling'))
    const ok = await sendMessage(
      WebextEvent.uninstallNativeWindowHost,
      null,
    ).catch(() => false)
    setStatus(ok ? 'missing' : 'installed')
    setMessage(
      t(
        ok
          ? 'settingPanel.nativeHostUninstallSuccess'
          : 'settingPanel.nativeHostUninstallFailed',
      ),
    )
  }

  const buttonStyle = {
    padding: '5px 10px',
    border: '1px solid #aaa',
    borderRadius: '5px',
    cursor: 'pointer',
  } as const

  return (
    <div style={{ display: 'grid', gap: '8px', lineHeight: 1.5 }}>
      <div>
        {t('settingPanel.nativeHostStatus')}：
        <strong
          style={{
            color:
              status === 'installed'
                ? '#389e0d'
                : status === 'missing'
                  ? '#cf1322'
                  : undefined,
          }}
        >
          {t(`settingPanel.nativeHostStatus_${status}`)}
        </strong>
      </div>
      <div>{t('settingPanel.nativeHostMissingConsequences')}</div>
      <div style={{ whiteSpace: 'pre-line' }}>
        {t('settingPanel.nativeHostInstallSteps')}
      </div>
      <code style={{ userSelect: 'text' }}>
        {t('settingPanel.nativeHostExtensionId')}：{chrome.runtime.id}
      </code>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        <button type="button" onClick={refresh} style={buttonStyle}>
          {t('settingPanel.nativeHostRecheck')}
        </button>
        <button type="button" onClick={openInstallGuide} style={buttonStyle}>
          {t('settingPanel.nativeHostOpenInstallGuide')}
        </button>
        <button
          type="button"
          onClick={() => {
            setBrowserLocalStorage(NATIVE_HOST_MISSING_REMINDER_DISABLED, false)
            setMessage(t('settingPanel.nativeHostReminderEnabled'))
          }}
          style={buttonStyle}
        >
          {t('settingPanel.nativeHostEnableReminder')}
        </button>
        <button
          type="button"
          disabled={status !== 'installed'}
          onClick={uninstall}
          style={{
            ...buttonStyle,
            cursor: status === 'installed' ? 'pointer' : 'not-allowed',
            opacity: status === 'installed' ? 1 : 0.5,
          }}
        >
          {t('settingPanel.nativeHostUninstall')}
        </button>
      </div>
      {message && <div>{message}</div>}
    </div>
  )
}

export default NativeHostSettings
