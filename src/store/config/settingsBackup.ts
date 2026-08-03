export const SETTINGS_BACKUP_SCHEMA_VERSION = 3
export const MAX_SETTINGS_BACKUP_BYTES = 10 * 1024 * 1024

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export type SettingsBackupErrorCode =
  | 'invalid'
  | 'newerVersion'
  | 'tooLarge'
  | 'wrongApp'

export class SettingsBackupError extends Error {
  constructor(public readonly code: SettingsBackupErrorCode) {
    super(code)
    this.name = 'SettingsBackupError'
  }
}

export type SettingsBackupData = {
  app: 'dmMiniPlayer'
  schemaVersion: number
  exportedAt: string
  extensionVersion?: string
  settings: Record<string, unknown>
  storage: {
    sync: Record<string, unknown>
    local: Record<string, unknown>
  }
  localStorage: Record<string, string | null>
}

export type SettingsRestorePlan = {
  schemaVersion: number
  settings: Record<string, unknown>
  storage: {
    sync?: Record<string, unknown>
    local?: Record<string, unknown>
  }
  localStorage: Record<string, string | null>
  ignoredSettings: number
  legacy: boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const readSafeRecord = (value: unknown) => {
  if (!isRecord(value)) throw new SettingsBackupError('invalid')
  if (Object.keys(value).some((key) => FORBIDDEN_KEYS.has(key))) {
    throw new SettingsBackupError('invalid')
  }
  return Object.fromEntries(Object.entries(value))
}

const hasOwn = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key)

export const parseSettingsBackup = (
  text: string,
  allowedSettingKeys: readonly string[],
  allowedLocalStorageKeys: readonly string[],
): SettingsRestorePlan => {
  if (new TextEncoder().encode(text).byteLength > MAX_SETTINGS_BACKUP_BYTES) {
    throw new SettingsBackupError('tooLarge')
  }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new SettingsBackupError('invalid')
  }
  const data = readSafeRecord(raw)

  if (hasOwn(data, 'app') && data.app !== 'dmMiniPlayer') {
    throw new SettingsBackupError('wrongApp')
  }

  const schemaVersion = data.schemaVersion ?? 1
  if (!Number.isInteger(schemaVersion) || (schemaVersion as number) < 1) {
    throw new SettingsBackupError('invalid')
  }
  if ((schemaVersion as number) > SETTINGS_BACKUP_SCHEMA_VERSION) {
    throw new SettingsBackupError('newerVersion')
  }

  const structured =
    hasOwn(data, 'settings') ||
    hasOwn(data, 'storage') ||
    hasOwn(data, 'localStorage') ||
    hasOwn(data, 'app')
  const rawSettings = hasOwn(data, 'settings')
    ? readSafeRecord(data.settings)
    : structured
      ? {}
      : data
  const allowedSettings = new Set(allowedSettingKeys)
  const settings = Object.fromEntries(
    Object.entries(rawSettings).filter(([key]) => allowedSettings.has(key)),
  )
  const ignoredSettings =
    Object.keys(rawSettings).length - Object.keys(settings).length

  const storage: SettingsRestorePlan['storage'] = {}
  if (hasOwn(data, 'storage')) {
    const rawStorage = readSafeRecord(data.storage)
    if (hasOwn(rawStorage, 'sync')) {
      storage.sync = readSafeRecord(rawStorage.sync)
    }
    if (hasOwn(rawStorage, 'local')) {
      storage.local = readSafeRecord(rawStorage.local)
    }
  }

  const localStorage: Record<string, string | null> = {}
  if (hasOwn(data, 'localStorage')) {
    const rawLocalStorage = readSafeRecord(data.localStorage)
    const allowedKeys = new Set(allowedLocalStorageKeys)
    for (const [key, value] of Object.entries(rawLocalStorage)) {
      if (!allowedKeys.has(key)) continue
      if (value !== null && typeof value !== 'string') {
        throw new SettingsBackupError('invalid')
      }
      localStorage[key] = value
    }
  }

  const hasRestorableData =
    Object.keys(settings).length > 0 ||
    storage.sync !== undefined ||
    storage.local !== undefined ||
    Object.keys(localStorage).length > 0
  if (!hasRestorableData) throw new SettingsBackupError('invalid')

  return {
    schemaVersion: schemaVersion as number,
    settings,
    storage,
    localStorage,
    ignoredSettings,
    legacy: !structured,
  }
}
