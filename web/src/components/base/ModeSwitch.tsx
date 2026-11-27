import clsx from 'clsx'
import { useTranslate } from '../../i18n/index.js'
import { setUiMode, useSettings } from '../../services/settings.js'
import styles from './ModeSwitch.module.css'

/** 效率模式 / 休闲模式的切换开关：两个分段按钮，键盘与读屏都能识别 */
export const ModeSwitch = ({ className }: { className?: string }) => {
  const t = useTranslate()
  const uiMode = useSettings((state) => state.uiMode)
  return (
    <div className={clsx(styles.switch, className)} role="group" aria-label={t('uiModeLabel')}>
      <button
        type="button"
        className={clsx(styles.option, uiMode === 'efficiency' && styles.active)}
        aria-pressed={uiMode === 'efficiency'}
        onClick={() => setUiMode('efficiency')}
      >
        {t('uiModeEfficiency')}
      </button>
      <button
        type="button"
        className={clsx(styles.option, uiMode === 'casual' && styles.active)}
        aria-pressed={uiMode === 'casual'}
        onClick={() => setUiMode('casual')}
      >
        {t('uiModeCasual')}
      </button>
    </div>
  )
}
