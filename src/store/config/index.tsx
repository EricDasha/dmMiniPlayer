import { config } from '@apad/setting-panel'
import { ATTR_DISABLE_INJECT_PIP } from '@root/shared/config'
import isDev from '@root/shared/isDev'
import isPluginEnv from '@root/shared/isPluginEnv'
import {
  DM_MINI_PLAYER_CONFIG,
  FLOAT_BTN_HIDDEN,
  LOCALE,
} from '@root/shared/storeKey'
import { createSettingPanel } from '@root/utils/createSettingPanel'
import { Language, t } from '@root/utils/i18n'
import {
  getBrowserSyncStorage,
  setBrowserLocalStorage,
  setBrowserSyncStorage,
  useBrowserSyncStorage,
} from '@root/utils/storage'
import { isUndefined } from 'lodash-es'
import { autorun, configure } from 'mobx'
import Browser from 'webextension-polyfill'
import config_base from './base'
import config_danmaku from './danmaku'
import { docPIPConfig } from './docPIP'
import config_features from './features'
import config_floatButton from './floatButton'
import config_shortcut from './shortcut'
import config_specialWebsites from './specialWebsites'
import config_subtitle from './subtitle'
import {
  MAX_SETTINGS_BACKUP_BYTES,
  parseSettingsBackup,
  SETTINGS_BACKUP_SCHEMA_VERSION,
  SettingsBackupError,
} from './settingsBackup'
import type { SettingsBackupData } from './settingsBackup'

export * from './base'

if (isDev) {
  configure({
    enforceActions: 'never',
  })
}

const SETTING_PANEL_LOCAL_STORAGE_KEY = '__settingPanel_config_save'
const PLAYER_VOLUME_LOCAL_STORAGE_KEY = 'vp_volume'
const BACKUP_LOCAL_STORAGE_KEYS = [
  SETTING_PANEL_LOCAL_STORAGE_KEY,
  PLAYER_VOLUME_LOCAL_STORAGE_KEY,
]

const rawSettingsMap = {
  ...config_floatButton,
  ...config_danmaku,
  ...config_specialWebsites,
  ...config_subtitle,
  ...docPIPConfig,
  ...config_shortcut,
  ...config_features,
  ...config_base,
}

const getStorageSnapshot = async () => {
  const [sync, local] = await Promise.all([
    Browser.storage.sync.get(null as any),
    Browser.storage.local.get(null as any),
  ])

  return {
    sync: sync as Record<string, unknown>,
    local: local as Record<string, unknown>,
  }
}

const getLocalStorageSnapshot = () =>
  Object.fromEntries(
    BACKUP_LOCAL_STORAGE_KEYS.map((key) => [key, localStorage.getItem(key)]),
  )

const restoreStorageArea = async (
  area: Browser.Storage.StorageArea,
  value: Record<string, unknown>,
) => {
  await area.clear()
  if (Object.keys(value).length) {
    await area.set(value)
  }
}

const restoreLocalStorage = (value: Record<string, string | null>) => {
  for (const key of BACKUP_LOCAL_STORAGE_KEYS) {
    if (!(key in value)) continue
    const nextValue = value[key]
    if (nextValue === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, nextValue)
    }
  }
}

// fork: 事务式设置导入导出（导入失败自动回滚），覆盖上游 base.tsx 的简易版本
const exportImportSettings = config({
  defaultValue: '',
  label: t('settingPanel.exportImportSettings' as any),
  desc: t('settingPanel.exportImportSettingsDesc' as any),
  render: () => {
    const btnStyle = {
      padding: '4px 12px',
      borderRadius: '4px',
      border: '1px solid #ddd',
      cursor: 'pointer',
      fontSize: '13px',
      background: '#f5f5f5',
    }
    const handleExport = async () => {
      try {
        downloadBackup(await createBackupData(), 'dmMiniPlayer-backup')
      } catch (error) {
        console.error('[settings backup] export failed', error)
        alert(t('settingPanel.exportError' as any))
      }
    }
    const handleImport = () => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json'
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (!file) return
        let rollbackData: SettingsBackupData | undefined
        let previousSettings: Record<string, unknown> | undefined
        try {
          if (file.size > MAX_SETTINGS_BACKUP_BYTES) {
            throw new SettingsBackupError('tooLarge')
          }
          const text = await file.text()
          const plan = parseSettingsBackup(
            text,
            Object.keys(settingsMap),
            BACKUP_LOCAL_STORAGE_KEYS,
          )
          const settings = plan.settings
          const storageItemCount =
            Object.keys(plan.storage.sync ?? {}).length +
            Object.keys(plan.storage.local ?? {}).length
          const summary = t('settingPanel.importSummary' as any)
            .replace('{settings}', String(Object.keys(settings).length))
            .replace('{storage}', String(storageItemCount))
            .replace('{ignored}', String(plan.ignoredSettings))

          if (
            !confirm(`${summary}\n\n${t('settingPanel.importConfirm' as any)}`)
          ) {
            return
          }

          previousSettings = getSettingSnapshot()
          rollbackData = await createBackupData()
          downloadBackup(rollbackData, 'dmMiniPlayer-before-restore')

          if (plan.storage.sync !== undefined) {
            const nextSync = { ...plan.storage.sync }
            if (Object.keys(settings).length) {
              nextSync[DM_MINI_PLAYER_CONFIG] = settings
            }
            await restoreStorageArea(Browser.storage.sync, nextSync)
          } else if (isPluginEnv && Object.keys(settings).length) {
            await setBrowserSyncStorage(DM_MINI_PLAYER_CONFIG, settings)
          }
          if (plan.storage.local !== undefined) {
            await restoreStorageArea(Browser.storage.local, plan.storage.local)
          }
          restoreLocalStorage(plan.localStorage)

          if (!isPluginEnv && Object.keys(settings).length) {
            localStorage.setItem(
              SETTING_PANEL_LOCAL_STORAGE_KEY,
              JSON.stringify(settings),
            )
          }

          if ('language' in settings) {
            await setBrowserLocalStorage(LOCALE, settings.language as any)
          }

          if ('floatButtonVisible' in settings) {
            await setBrowserSyncStorage(
              FLOAT_BTN_HIDDEN,
              !settings.floatButtonVisible,
            )
          }

          if (Object.keys(settings).length) _updateConfig(settings)
          alert(t('settingPanel.importSuccess'))
          setTimeout(() => location.reload(), 100)
        } catch (error) {
          console.error('[settings backup] restore failed', error)
          if (rollbackData) {
            try {
              await restoreStorageArea(
                Browser.storage.sync,
                rollbackData.storage.sync,
              )
              await restoreStorageArea(
                Browser.storage.local,
                rollbackData.storage.local,
              )
              restoreLocalStorage(rollbackData.localStorage)
              if (previousSettings) _updateConfig(previousSettings)
            } catch (rollbackError) {
              console.error('[settings backup] rollback failed', rollbackError)
              alert(t('settingPanel.importRollbackError' as any))
              return
            }
          }
          alert(getImportErrorMessage(error))
        }
      }
      input.click()
    }
    return (
      <div style={{ display: 'flex', gap: '8px' }}>
        <button onClick={handleExport} style={btnStyle}>
          {t('settingPanel.exportSettings')}
        </button>
        <button onClick={handleImport} style={btnStyle}>
          {t('settingPanel.importSettings')}
        </button>
      </div>
    )
  },
})

const settingsMap = {
  ...rawSettingsMap,
  exportImportSettings,
}

const {
  openSettingPanel,
  closeSettingPanel,
  observe,
  updateConfig: _updateConfig,
  saveConfig,
  configStore,
} = createSettingPanel({
  settings: settingsMap,
  saveKey: DM_MINI_PLAYER_CONFIG,
  async onSave(newConfig) {
    if (newConfig.language) {
      await setBrowserLocalStorage(LOCALE, newConfig.language as Language)
      location.reload()
      delete (newConfig as any).language
    }
    if (newConfig.useDocPIP) {
      if (!window?.documentPictureInPicture) {
        delete (newConfig as any).useDocPIP
        alert(t('settingPanel.unsupportDocPIPTips'))
      }
    }
    if (newConfig.injectPIPFn === false) {
      document.documentElement.setAttribute(ATTR_DISABLE_INJECT_PIP, 'true')
    } else {
      document.documentElement.removeAttribute(ATTR_DISABLE_INJECT_PIP)
    }
  },
  async onInitLoadConfig(config) {
    if (!isPluginEnv) return config
    // 这里去掉as any会触发ts的循环type错误
    const savedConfig = (await getBrowserSyncStorage(
      DM_MINI_PLAYER_CONFIG,
    )) as any

    const loadedConfig = { ...config, ...(savedConfig ?? {}) } as typeof config

    // 去除旧config
    if (typeof loadedConfig.movePIPInOpen === 'boolean') {
      delete loadedConfig.movePIPInOpen
    }

    return loadedConfig
  },
})

const getSettingSnapshot = () =>
  Object.fromEntries(
    Object.keys(settingsMap).map((key) => [
      key,
      configStore[key as keyof typeof configStore],
    ]),
  )

const createBackupData = async (): Promise<SettingsBackupData> => ({
  app: 'dmMiniPlayer',
  schemaVersion: SETTINGS_BACKUP_SCHEMA_VERSION,
  exportedAt: new Date().toISOString(),
  extensionVersion: isPluginEnv
    ? Browser.runtime.getManifest().version
    : undefined,
  settings: getSettingSnapshot(),
  storage: await getStorageSnapshot(),
  localStorage: getLocalStorageSnapshot(),
})

const downloadBackup = (data: SettingsBackupData, prefix: string) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .replace('Z', '')
  link.href = url
  link.download = `${prefix}-${timestamp}.json`
  link.style.display = 'none'
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

const getImportErrorMessage = (error: unknown) => {
  if (!(error instanceof SettingsBackupError)) {
    return t('settingPanel.importRestoreError' as any)
  }
  const keyByCode = {
    invalid: 'settingPanel.importError',
    newerVersion: 'settingPanel.importNewerVersionError',
    tooLarge: 'settingPanel.importTooLargeError',
    wrongApp: 'settingPanel.importWrongAppError',
  } as const
  return t(keyByCode[error.code] as any)
}

const updateConfig = async (config?: Partial<typeof configStore>) => {
  config ??= await getBrowserSyncStorage(DM_MINI_PLAYER_CONFIG)
  if (!config) return

  if (config.injectPIPFn === false) {
    document.documentElement.setAttribute(ATTR_DISABLE_INJECT_PIP, 'true')
  } else {
    document.documentElement.removeAttribute(ATTR_DISABLE_INJECT_PIP)
  }
  _updateConfig(config)
}

window.configStore = configStore
window.openSettingPanel = openSettingPanel

let firstChange = true
// 同步icon栏的修改隐藏floatButton
autorun(() => {
  const val = !configStore.floatButtonVisible
  // 第一次的值是不对的
  if (firstChange) {
    firstChange = false
    return
  }
  setBrowserSyncStorage(FLOAT_BTN_HIDDEN, val)
})
useBrowserSyncStorage(FLOAT_BTN_HIDDEN, async (val) => {
  if (isUndefined(val)) return
  _updateConfig({ floatButtonVisible: !val })
  saveConfig()
})

export default configStore
export {
  configStore,
  openSettingPanel,
  closeSettingPanel,
  observe,
  updateConfig,
  saveConfig,
}
