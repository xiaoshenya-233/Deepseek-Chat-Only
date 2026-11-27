import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import logoUrl from '../../assets/logo.png'
import { ChatInput } from '../chatInput/ChatInput.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './Welcome.module.css'

/** 新对话：logo + 问候语 + 输入框。桌面端居中；移动端输入框吸底 */
export const Welcome = ({ message }: { message?: string } = {}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  return (
    <div className={styles.container}>
      {isMobile ? <MobileHeader /> : null}
      <div className={styles.welcome}>
        <img className={styles.logo} src={logoUrl} alt="" aria-hidden="true" draggable={false} />
        <div className={styles.greeting}>{message ?? t('welcomeMessageChat250808')}</div>
        <ChatInput sessionId={null} />
        {isMobile ? <div className={styles.caveat}>{t('contentCaveat')}</div> : null}
      </div>
    </div>
  )
}
