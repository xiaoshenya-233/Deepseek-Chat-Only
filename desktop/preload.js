'use strict'

// Exposes the exact same contract as the Android @JavascriptInterface bridge,
// so static/js/download-bridge.js and the web bundle stay platform agnostic.

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('DeepseekNative', {
  isDesktop: true,
  platform: typeof process === 'object' && process ? process.platform : 'unknown',
  beginDownload: (ticket, name, mimeType, size) =>
    ipcRenderer.invoke('native:download-begin', { ticket, name, mimeType, size }),
  writeDownload: (ticket, base64) =>
    ipcRenderer.invoke('native:download-write', { ticket, base64 }),
  endDownload: (ticket) => ipcRenderer.invoke('native:download-end', ticket),
  cancelDownload: (ticket) => ipcRenderer.invoke('native:download-cancel', ticket),
  openAttachment: (name, mimeType, base64) =>
    ipcRenderer.invoke('native:open-attachment', { name, mimeType, base64 }),
  showAttachmentError: (message) =>
    ipcRenderer.invoke('native:attachment-error', String(message || '')),
  getPaths: () => ipcRenderer.invoke('native:paths')
})
