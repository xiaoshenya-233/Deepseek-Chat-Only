import { useTranslate } from '../../i18n/index.js'
import { memo, useEffect, useRef, useState } from 'react'
import { useTheme } from '../../app/theme.js'
import { renderMermaid } from '../../services/markdown/mermaid.js'
import {
  downloadBlob,
  mermaidFileName,
  normalizeSvgSize,
  svgToPng,
} from '../../services/markdown/mermaidImage.js'
import { IconDownloadOutline16, IconRightUpOutline14 } from '../base/icons.js'
import { showToast } from '../base/toastState.js'
import { openMermaidPreview } from './mermaidPreviewState.js'

/** 流式绘制最新内容、保留上次有效图；回答结束后才显示渲染错误。 */
export const MermaidDiagram = memo(function MermaidDiagram({
  code,
  loading,
}: {
  code: string
  loading: boolean
}) {
  const t = useTranslate()
  const dark = useTheme() === 'dark'
  const wrapRef = useRef<HTMLDivElement>(null)
  const [result, setResult] = useState({ svg: '', failedCode: null as string | null })
  const latestCodeRef = useRef(code)
  latestCodeRef.current = code
  // 流式阶段从 ref 取最新文本，避免每个片段都取消绘制；结束后立即绘制完整内容。
  const finalCode = loading ? null : code

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let previousCode: string | undefined
    let displayedCode: string | undefined

    const draw = async (input: string) => {
      if (input === displayedCode || cancelled) {
        return
      }
      const svg = await renderMermaid(input, dark, () => cancelled)
      if (svg && !cancelled) {
        displayedCode = input
        setResult({ svg, failedCode: null })
      }
    }

    const renderLatest = async () => {
      const input = latestCodeRef.current
      if (input !== previousCode) {
        previousCode = input
        try {
          await draw(input)
        } catch {
          if (!cancelled) {
            if (loading) {
              // 流式片段的末行可能包含未完成的节点，仅绘制前面的完整行。
              const text = input.trimEnd()
              const lineEnd = Math.max(text.lastIndexOf('\n'), text.lastIndexOf('\r'))
              const prefix = text.slice(0, Math.max(0, lineEnd))
              // 已显示的内容覆盖当前前缀时保持图形。
              if (prefix && !displayedCode?.startsWith(prefix)) {
                try {
                  await draw(prefix)
                } catch {
                  // 前缀也可能尚未构成完整语法，保留已有图。
                }
              }
            } else {
              setResult({ svg: '', failedCode: input })
            }
          }
        }
      }
      // 当前帧结束后绘制最新片段，连续输入合并为一次绘制。
      if (!cancelled && loading) {
        timer = setTimeout(renderLatest, 100)
      }
    }

    void renderLatest()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [dark, loading, finalCode])

  if (!code.trim() || !result.svg) {
    return (
      <div className="md-mermaid-status" role="status">
        {!loading && !code.trim()
          ? t('mermaidEmpty')
          : !loading && result.failedCode === code
            ? t('mermaidRenderFail')
            : t('mermaidLoading')}
      </div>
    )
  }

  /** 当前渲染出的 SVG 源码：预览与保存都用它，避免再从 DOM 里取样式（限定在图表容器内，别选中工具栏图标） */
  const currentSvg = () =>
    wrapRef.current?.querySelector<SVGSVGElement>('.md-mermaid-diagram svg')

  const openPreview = () => {
    const svg = currentSvg()
    if (svg) {
      openMermaidPreview(normalizeSvgSize(new XMLSerializer().serializeToString(svg)).markup, dark)
    }
  }

  const saveImage = async () => {
    const svg = currentSvg()
    if (!svg) {
      return
    }
    try {
      const markup = new XMLSerializer().serializeToString(svg)
      const blob = await svgToPng(markup, { background: dark ? '#1b1b1f' : '#ffffff' })
      downloadBlob(blob, mermaidFileName(dark))
    } catch {
      showToast({ key: 'mermaidSaveFailed' })
    }
  }

  return (
    <div className="md-mermaid" ref={wrapRef}>
      <div className="md-mermaid-actions">
        <button
          type="button"
          className="md-mermaid-action"
          aria-label={t('mermaidExpand')}
          title={t('mermaidExpand')}
          onClick={openPreview}
        >
          <IconRightUpOutline14 />
        </button>
        <button
          type="button"
          className="md-mermaid-action"
          aria-label={t('mermaidSaveImage')}
          title={t('mermaidSaveImage')}
          onClick={() => void saveImage()}
        >
          <IconDownloadOutline16 />
        </button>
      </div>
      <div
        className="md-mermaid-diagram"
        role="button"
        tabIndex={0}
        aria-label={t('mermaidExpand')}
        onClick={openPreview}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            openPreview()
          }
        }}
        dangerouslySetInnerHTML={{ __html: result.svg }}
      />
    </div>
  )
})
