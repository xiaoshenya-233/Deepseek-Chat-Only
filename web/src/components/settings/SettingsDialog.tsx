import clsx from 'clsx'
import { useRef, useState, type ReactNode } from 'react'
import {
  IconAutoThemeOutline16,
  IconDarkOutline16,
  IconDataOutline16,
  IconFollowsystemOutline16,
  IconLightOutline16,
  IconSettingsOutline16,
  IconUploadOutline14,
} from '../base/icons.js'
import { BackupError, importHistory } from '../../services/chat/backup.js'
import { SessionManageDialog, type SessionManageMode } from './SessionManageDialog.js'
import { useIsMobile } from '../../app/viewport.js'
import { useChatStore } from '../../services/chat/store.js'
import { regionCodes, getRegionName, provinces } from '../../services/location.js'
import {
  isChineseBrowser,
  setAutoSummary,
  setCollapseThinking,
  setLocale,
  setLocation,
  setThemePreference,
  setTtsVoice,
  setUiScale,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  UI_SCALE_STEP,
  useSettings,
  type ThemePreference,
} from '../../services/settings.js'
import { useTranslate, type TranslationKey, type TranslationMessage } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { ModeSwitch } from '../base/ModeSwitch.js'
import { Select } from '../base/Select.js'
import {
  beginBackupProgress,
  finishBackupProgress,
  updateBackupProgress,
} from '../backup/backupProgressState.js'
import { ApiKeyConfirm, ApiKeyField, useApiKeyEditor } from './ApiKeyField.js'
import { ImportByUrlDialog } from './ImportByUrlDialog.js'
import { PromptManageDialog } from './PromptManageDialog.js'
import { closeSettings, useSettingsDialog, type SettingsSection } from './settingsDialogState.js'
import styles from './Settings.module.css'

/**
 * 璁剧疆寮圭獥锛氬垎銆岄€氱敤璁剧疆銆嶏紙涓婚銆佽瑷€銆佹湕璇婚煶鑹层€佷綅缃級涓庛€屾暟鎹鐞嗐€嶏紙API Key銆佸鍏ャ€佸鍑恒€佸垹闄わ級銆?
 * 妗岄潰绔负灞呬腑寮圭獥銆佸乏渚у鑸紱绉诲姩绔负搴曢儴寮瑰眰銆佸鑸í鎺掑湪鍐呭涓婃柟
 */
export const SettingsDialog = () => {
  const open = useSettingsDialog((state) => state.open)
  return open ? <SettingsContent /> : null
}

const sections: { value: SettingsSection; label: TranslationKey; icon: ReactNode }[] = [
  {
    value: 'general',
    label: 'settingDialogAsideGeneralOptionLabel',
    icon: <IconSettingsOutline16 />,
  },
  { value: 'data', label: 'settingDialogAsideDataOptionLabel', icon: <IconDataOutline16 /> },
]

const SettingsContent = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  // 鎵撳紑鏃舵寜璋冪敤鏂规寚瀹氱殑鍒嗙粍閫変腑锛屼箣鍚庡湪寮圭獥鍐呭垏鎹?
  const [section, setSection] = useState(() => useSettingsDialog.getState().section)
  // 鍒囨崲鍒嗙粍涓嶄涪澶辨鍦ㄨ緭鍏ョ殑 API Key 涓庡鍏ョ姸鎬?
  const apiKeyEditor = useApiKeyEditor()
  const historyImport = useHistoryImport()
  const replacingHistory = useChatStore((state) => state.importingHistory)
  const historyBusy = historyImport.busy || replacingHistory
  /** null锛氬叧闂紱export / manage锛氬璇濈鐞嗗脊绐楃殑涓ょ鐢ㄩ€?*/
  const [manager, setManager] = useState<SessionManageMode | null>(null)
  const [urlDialogOpen, setUrlDialogOpen] = useState(false)
  const [promptDialogOpen, setPromptDialogOpen] = useState(false)
  return (
    <>
      <Modal
        title={t('settings')}
        closable
        className={styles.dialog}
        mainClassName={styles.dialogMain}
        onClose={closeSettings}
      >
        <div role="tablist" className={styles.navigation}>
          {sections.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={section === item.value}
              className={clsx(styles.navItem, section === item.value && styles.navItemActive)}
              onClick={() => setSection(item.value)}
            >
              {item.icon}
              {t(item.label)}
            </button>
          ))}
        </div>
        <div role="tabpanel" className={styles.content}>
          {section === 'general' ? (
            <>
              <UiModeSetting />
              <UiScaleSetting />
              <AutoSummarySetting />
              <ThinkingSetting />
              <ThemeSetting />
              <LocaleSetting />
              <TtsVoiceSetting />
              <LocationSetting />
            </>
          ) : (
            <>
              <ApiKeyField editor={apiKeyEditor} />
              <ImportHistory historyImport={historyImport} disabled={historyBusy} />
              <SettingCell
                label={t('historyImportFromUrl')}
                description={t('historyImportFromUrlDescription')}
                status={null}
                action={
                  <Button
                    variant="outlined"
                    size="m"
                    className={styles.cellButton}
                    disabled={historyBusy}
                    onClick={() => setUrlDialogOpen(true)}
                  >
                    {t('historyImportFromUrlOpen')}
                  </Button>
                }
              />
              <SettingCell
                label={t('sessionManageLabel')}
                description={t('sessionManageDescription')}
                status={null}
                action={
                  <Button
                    variant="outlined"
                    size="m"
                    className={styles.cellButton}
                    disabled={historyBusy}
                    onClick={() => setManager('manage')}
                  >
                    {t('promptsManagerOpen')}
                  </Button>
                }
              />
              <SettingCell
                label={t('promptManageLabel')}
                description={t('promptManageDescription')}
                status={null}
                action={
                  <Button
                    variant="outlined"
                    size="m"
                    className={styles.cellButton}
                    disabled={historyBusy}
                    onClick={() => setPromptDialogOpen(true)}
                  >
                    {t('promptManageOpen')}
                  </Button>
                }
              />
              {isMobile ? <ApiKeyConfirm editor={apiKeyEditor} /> : null}
            </>
          )}
        </div>
      </Modal>
      {historyImport.file ? <ImportConfirm historyImport={historyImport} /> : null}
      {urlDialogOpen ? (
        <ImportByUrlDialog
          onClose={() => setUrlDialogOpen(false)}
          onPicked={(file) => historyImport.select(file)}
        />
      ) : null}
      {manager ? (
        // key 随 mode 变化：从「导出」切到「管理」时重置选择（两者默认值不同）
        <SessionManageDialog key={manager} onClose={() => setManager(null)} />
      ) : null}
      {promptDialogOpen ? <PromptManageDialog onClose={() => setPromptDialogOpen(false)} /> : null}
    </>
  )
}

/** 界面模式：效率模式（原界面）/ 休闲模式（聊天软件式导航 + 主页） */
const UiModeSetting = () => {
  const t = useTranslate()
  return (
    <SettingCell
      label={t('uiModeLabel')}
      description={t('uiModeDescription')}
      status={null}
      action={<ModeSwitch />}
    />
  )
}

/** 界面缩放：-10% / +10%，一键恢复 100%，值存 localStorage 并在 App 里作用于 html zoom */
const UiScaleSetting = () => {
  const t = useTranslate()
  const uiScale = useSettings((state) => state.uiScale)
  const percent = Math.round(uiScale * 100)
  return (
    <SettingCell
      label={t('uiScaleLabel')}
      description={t('uiScaleDescription')}
      status={null}
      action={
        <div className={styles.uiScale} role="group" aria-label={t('uiScaleLabel')}>
          <button
            type="button"
            className={styles.uiScaleStep}
            aria-label={t('uiScaleDecrease')}
            disabled={uiScale <= UI_SCALE_MIN + 0.001}
            onClick={() => setUiScale(uiScale - UI_SCALE_STEP)}
          >
            −
          </button>
          <button
            type="button"
            className={styles.uiScaleValue}
            aria-label={t('uiScaleReset')}
            title={t('uiScaleReset')}
            onClick={() => setUiScale(1)}
          >
            {percent}%
          </button>
          <button
            type="button"
            className={styles.uiScaleStep}
            aria-label={t('uiScaleIncrease')}
            disabled={uiScale >= UI_SCALE_MAX - 0.001}
            onClick={() => setUiScale(uiScale + UI_SCALE_STEP)}
          >
            +
          </button>
        </div>
      }
    />
  )
}

/** 自动摘要开关：开启后长对话只发送「摘要 + 最近几轮」 */
const AutoSummarySetting = () => {
  const t = useTranslate()
  const autoSummary = useSettings((state) => state.autoSummary)
  return (
    <SettingCell
      label={t('autoSummaryLabel')}
      description={t('autoSummaryDescription')}
      status={null}
      action={
        <button
          type="button"
          role="switch"
          aria-checked={autoSummary}
          aria-label={t('autoSummaryLabel')}
          className={clsx(styles.switch, autoSummary && styles.switchOn)}
          onClick={() => setAutoSummary(!autoSummary)}
        >
          <span className={styles.switchThumb} />
        </button>
      }
    />
  )
}

/** 折叠思考过程：收起所有「已思考」正文，只留标题行；单条消息仍可点标题展开 */
const ThinkingSetting = () => {
  const t = useTranslate()
  const collapseThinking = useSettings((state) => state.collapseThinking)
  return (
    <SettingCell
      label={t('collapseThinkingLabel')}
      description={t('collapseThinkingDescription')}
      status={null}
      action={
        <button
          type="button"
          role="switch"
          aria-checked={collapseThinking}
          aria-label={t('collapseThinkingLabel')}
          className={clsx(styles.switch, collapseThinking && styles.switchOn)}
          onClick={() => setCollapseThinking(!collapseThinking)}
        >
          <span className={styles.switchThumb} />
        </button>
      }
    />
  )
}

const LocationSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const location = useSettings((state) => state.location)
  const province =
    location?.region === 'CN'
      ? provinces.find((item) => item.code === location.province)
      : undefined

  return (
    <SettingCell
      label={t('settingsLocation')}
      status={null}
      className={styles.locationCell}
      action={
        <div className={styles.locationSelectors}>
          {isChineseBrowser() ? (
            <>
              <Select
                ariaLabel={t('settingsLocationProvince')}
                className={styles.provinceSelect}
                value={province?.code ?? ''}
                placeholder={t('settingsLocationProvince')}
                options={provinces.map((item) => ({ value: item.code, label: item.name }))}
                onChange={(value) => {
                  if (value !== province?.code) {
                    setLocation({ region: 'CN', province: value })
                  }
                }}
              />
              <Select
                ariaLabel={t('settingsLocationCity')}
                className={styles.citySelect}
                value={province ? (location?.city ?? '') : ''}
                disabled={!province?.cities.length}
                placeholder={t('settingsLocationCity')}
                options={
                  province?.cities.map((item) => ({ value: item.code, label: item.name })) ?? []
                }
                onChange={(value) => {
                  if (province) {
                    setLocation({ region: 'CN', province: province.code, city: value })
                  }
                }}
              />
            </>
          ) : (
            <Select
              ariaLabel={t('settingsLocationRegion')}
              className={styles.regionSelect}
              value={location?.region ?? ''}
              placeholder={t('settingsLocationRegion')}
              options={regionCodes
                .map((code) => ({ value: code, label: getRegionName(code, locale) }))
                .sort((a, b) => a.label.localeCompare(b.label, locale))}
              onChange={(value) => setLocation({ region: value })}
            />
          )}
        </div>
      }
    />
  )
}

const LocaleSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  return (
    <SettingCell
      label={t('settingsLocalePreference')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsLocalePreference')}
          value={locale}
          options={[
            { value: 'zh-CN', label: t('settingsLocaleZhCN'), lang: 'zh-CN' },
            { value: 'en-US', label: t('settingsLocaleEnUS'), lang: 'en' },
          ]}
          onChange={setLocale}
        />
      }
    />
  )
}

/** 鏈楄闊宠壊锛歴tella锛堟捣鏄燂紝濂冲０锛? tide锛堟殫娼紝鐢峰０锛?*/
const TtsVoiceSetting = () => {
  const t = useTranslate()
  const ttsVoice = useSettings((state) => state.ttsVoice)
  return (
    <SettingCell
      label={t('settingsTtsVoice')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsTtsVoice')}
          value={ttsVoice}
          options={[
            { value: 'stella', label: t('settingsTtsVoiceStella') },
            { value: 'tide', label: t('settingsTtsVoiceTide') },
          ]}
          onChange={setTtsVoice}
        />
      }
    />
  )
}

/** 瑕嗙洊瀵煎叆鐨勪簩娆＄‘璁わ紝鍙犲湪璁剧疆寮圭獥涓?*/
const ImportConfirm = ({
  historyImport,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
}) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('historyImportConfirmTitle')}
      className={styles.importConfirm}
      onClose={historyImport.cancel}
      footer={
        <>
          <Button variant="outlined" size="m" autoFocus onClick={historyImport.cancel}>
            {t('cancel')}
          </Button>
          <Button variant="dangerOutlined" size="m" onClick={() => void historyImport.confirm()}>
            {t('historyImportConfirm')}
          </Button>
        </>
      }
    >
      <div className={styles.importConfirmText}>{t('historyImportConfirmDescription')}</div>
    </Modal>
  )
}

const themeOptions: { value: ThemePreference; label: TranslationKey; icon: ReactNode }[] = [
  {
    value: 'light',
    label: 'avatarMenuSettingsDialogThemeSelectLightOption',
    icon: <IconLightOutline16 />,
  },
  {
    value: 'dark',
    label: 'avatarMenuSettingsDialogThemeSelectDarkOption',
    icon: <IconDarkOutline16 />,
  },
  {
    value: 'system',
    label: 'avatarMenuSettingsDialogThemeSelectSystemOption',
    icon: <IconFollowsystemOutline16 />,
  },
  {
    value: 'auto',
    label: 'avatarMenuSettingsDialogThemeSelectAutoOption',
    icon: <IconAutoThemeOutline16 />,
  },
]

/**
 * 涓婚椤癸細鏍囬涓嬫柟娴呰壊 / 娣辫壊 / 璺熼殢绯荤粺涓変釜閫夊潡銆?
 * 涓庝笅鏂硅瑷€閫夐」杩炵画鎺掑垪銆?
 */
const ThemeSetting = () => {
  const t = useTranslate()
  const themePreference = useSettings((state) => state.themePreference)
  const label = t('avatarMenuSettingsDialogThemeItemLabel')
  return (
    <div className={styles.theme}>
      {label}
      <div role="radiogroup" aria-label={label} className={styles.themeOptions}>
        {themeOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={themePreference === option.value}
            className={clsx(
              styles.themeOption,
              themePreference === option.value && styles.themeOptionSelected
            )}
            onClick={() => setThemePreference(option.value)}
          >
            {option.icon}
            {t(option.label)}
          </button>
        ))}
      </div>
    </div>
  )
}

/** `reason` 涓哄け璐ュ師鍥犵殑鏂囨 key锛屽睍绀烘椂鎸夊綋鍓嶈瑷€缈昏瘧鍚庡～鍏?`message` 鍙傛暟銆?*/
type Status = (TranslationMessage & { error?: boolean; reason?: TranslationKey }) | null

/** 瀵煎嚭澶辫触闄勫甫鍘熷洜锛氶鏈熺殑閿欒鐢ㄥ搴旀枃妗堜綔鍘熷洜锛屽叾浠栭敊璇敤閿欒淇℃伅銆?*/
const errorStatus = (key: TranslationKey, error: unknown): Status => ({
  key,
  ...(error instanceof BackupError
    ? { reason: error.key }
    : { params: { message: error instanceof Error ? error.message : String(error) } }),
  error: true,
})

const SettingCell = ({
  label,
  description,
  status,
  action,
  className,
}: {
  label: string
  description?: string
  status: Status
  action: ReactNode
  className?: string
}) => {
  const t = useTranslate()
  return (
    <div className={clsx(styles.cell, styles.row, className)}>
      <div className={styles.text}>
        <div className={styles.label}>{label}</div>
        {status || description ? (
          <div className={clsx(styles.description, status?.error && styles.error)}>
            {status
              ? t(status.key, status.reason ? { message: t(status.reason) } : status.params)
              : description}
          </div>
        ) : null}
      </div>
      {action}
    </div>
  )
}

/** 閫夋枃浠跺悗鍏堟彁绀鸿鐩栵紱纭鍚庢墠妫€鏌ユ枃浠跺苟鎵ц瀵煎叆锛屼换浣曢敊璇兘鎻愮ず瀵煎叆澶辫触銆?*/
const useHistoryImport = () => {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const importing = useRef(false)

  const confirm = async () => {
    if (!file || importing.current) {
      return
    }
    importing.current = true
    setFile(null)
    setBusy(true)
    setStatus(null)
    const controller = new AbortController()
    beginBackupProgress('backupProgressImporting', () => controller.abort())
    try {
      const count = await importHistory(file, {
        signal: controller.signal,
        onProgress: ({ label, percent }) => updateBackupProgress(label, percent),
      })
      finishBackupProgress('done')
      setStatus({ key: count === 1 ? 'historyImportedOne' : 'historyImported', params: { count } })
    } catch (error) {
      if (error instanceof BackupError && error.key === 'historyImportCancelled') {
        finishBackupProgress('cancelled')
        setStatus({ key: 'historyImportCancelled' })
      } else {
        finishBackupProgress('error')
        setStatus(errorStatus('historyImportFailedReason', error))
      }
    } finally {
      importing.current = false
      setBusy(false)
    }
  }

  return { file, busy, status, select: setFile, cancel: () => setFile(null), confirm }
}

/** 瀵煎叆 = 瑕嗙洊锛氱敤閫変腑鏂囦欢鏇挎崲鏈湴鍏ㄩ儴浼氳瘽涓庨檮浠躲€?*/
const ImportHistory = ({
  historyImport,
  disabled,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
  disabled: boolean
}) => {
  const t = useTranslate()
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <SettingCell
      label={t('historyImport')}
      description={t('historyImportDescription')}
      status={historyImport.status}
      action={
        <>
          <Button
            variant="outlined"
            size="m"
            className={clsx(styles.cellButton, styles.uploadButton)}
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            <IconUploadOutline14 />
            {t('upload')}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) {
                historyImport.select(file)
              }
            }}
          />
        </>
      }
    />
  )
}
