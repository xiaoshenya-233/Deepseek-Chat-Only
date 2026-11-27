import { IconChevronRightOutline14, IconMenuOutline20, IconNewChatOutline20 } from '../base/icons.js'
import { useTranslate } from '../../i18n/index.js'
import type { ReactNode } from 'react'
import { newChat } from '../../services/chat/store.js'
import { IconButton } from '../base/IconButton.js'
import { openMobileSider } from '../sider/mobileSiderState.js'
import styles from './MobileHeader.module.css'

export const MobileHeader = ({
  title,
  action,
  onBack,
}: {
  title?: string
  action?: ReactNode
  /** 休闲模式：返回上一级（聊天列表），替代打开侧边栏 */
  onBack?: () => void
}) => {
  const t = useTranslate()
  return (
    <div className={styles.header}>
      {onBack ? (
        <IconButton
          size="xl"
          tone="primary"
          className={styles.back}
          icon={<IconChevronRightOutline14 />}
          aria-label={t('back')}
          onClick={onBack}
        />
      ) : (
        <IconButton
          size="xl"
          tone="primary"
          icon={<IconMenuOutline20 />}
          aria-label={t('expandSiderbarButton')}
          onClick={openMobileSider}
        />
      )}
      {title === undefined ? null : (
        <>
          <div className={styles.title}>{title}</div>
          {action}
          <IconButton
            size="xl"
            tone="primary"
            icon={<IconNewChatOutline20 />}
            aria-label={t('newChat')}
            onClick={newChat}
          />
        </>
      )}
    </div>
  )
}
