//
//  Bridge.swift
//  Deepseek Chat Only
//
//  网页侧的 window.DeepseekNative（见 native/download-bridge.js）在这里落地：
//  WKWebView 没有同步 JS 接口，所以注入的 shim 用 postMessage + Promise 包装，
//  调用形态与 Electron / Android 壳保持一致，网页代码无需区分平台。
//
//  方法：
//    beginDownload(ticket, name, mime, size)  开始一次导出，成功后回调 __deepseekDownloadTarget
//    writeDownload(ticket, base64) -> Bool    写入一块数据
//    endDownload(ticket) -> Bool              收尾，文件落到 App 的文稿目录并弹出系统分享
//    cancelDownload(ticket)                   放弃并删除临时文件
//    openAttachment(name, mime, base64)       单个附件预览（分享面板）
//    showAttachmentError(message)             原生错误提示
//

import Foundation
import UIKit
import WebKit

final class Bridge: NSObject, WKScriptMessageHandler {
    /// 注入到文档最前面的 shim，必须在网页脚本之前提供 window.DeepseekNative。
    static let shimScript = """
    (() => {
      if (window.DeepseekNative) { return }
      const handler = window.webkit && window.webkit.messageHandlers
        ? window.webkit.messageHandlers.dscBridge
        : null;
      if (!handler) { return }
      const pending = new Map();
      let seq = 0;
      const post = (payload) => {
        try { handler.postMessage(payload) } catch (error) {}
      };
      window.__dscNativeResolve = (id, value) => {
        const entry = pending.get(id);
        if (!entry) { return }
        pending.delete(id);
        entry(value);
      };
      const call = (op, params) => new Promise((resolve) => {
        const id = ++seq;
        pending.set(id, resolve);
        post(Object.assign({ id, op }, params));
      });
      window.DeepseekNative = {
        beginDownload(ticket, name, mimeType, sizeText) {
          post({ op: 'beginDownload', ticket, name, mimeType, sizeText });
        },
        writeDownload(ticket, base64) {
          return call('writeDownload', { ticket, data: base64 }).then((value) => value === true);
        },
        endDownload(ticket) {
          return call('endDownload', { ticket }).then((value) => value === true);
        },
        cancelDownload(ticket) {
          post({ op: 'cancelDownload', ticket });
        },
        openAttachment(name, mimeType, base64) {
          void call('openAttachment', { name, mimeType, data: base64 });
        },
        showAttachmentError(message) {
          post({ op: 'showAttachmentError', message });
        },
      };
    })();
    """

    weak var webView: WKWebView?

    private struct DownloadState {
        let fileURL: URL
        let handle: FileHandle
        let name: String
    }

    private var downloads: [String: DownloadState] = [:]

    // MARK: - 消息分发

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let op = body["op"] as? String else {
            return
        }
        switch op {
        case "beginDownload":
            beginDownload(body)
        case "writeDownload":
            writeDownload(body)
        case "endDownload":
            endDownload(body)
        case "cancelDownload":
            cancelDownload(body)
        case "openAttachment":
            openAttachment(body)
        case "showAttachmentError":
            presentAlert(body["message"] as? String ?? "附件打开失败")
        default:
            break
        }
    }

    // MARK: - 导出

    private func beginDownload(_ body: [String: Any]) {
        guard let ticket = body["ticket"] as? String else {
            return
        }
        let name = Self.safeName(body["name"] as? String, fallback: "deepseek_data.zip")
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("exports", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let fileURL = directory.appendingPathComponent("\(ticket)-\(name)")
            guard FileManager.default.createFile(atPath: fileURL.path, contents: nil) else {
                throw CocoaError(.fileWriteUnknown)
            }
            let handle = try FileHandle(forWritingTo: fileURL)
            downloads[ticket] = DownloadState(fileURL: fileURL, handle: handle, name: name)
            notifyTarget(ticket: ticket, ok: true, message: "")
        } catch {
            notifyTarget(ticket: ticket, ok: false, message: "无法创建导出文件")
        }
    }

    private func writeDownload(_ body: [String: Any]) {
        guard let ticket = body["ticket"] as? String, let state = downloads[ticket] else {
            resolve(body["id"], value: false)
            return
        }
        guard let text = body["data"] as? String, let data = Data(base64Encoded: text) else {
            resolve(body["id"], value: false)
            return
        }
        do {
            try state.handle.write(contentsOf: data)
            resolve(body["id"], value: true)
        } catch {
            resolve(body["id"], value: false)
        }
    }

    private func endDownload(_ body: [String: Any]) {
        guard let ticket = body["ticket"] as? String, let state = downloads.removeValue(forKey: ticket) else {
            resolve(body["id"], value: false)
            return
        }
        try? state.handle.close()
        let destination = Self.documentsDirectory().appendingPathComponent(state.name)
        do {
            if FileManager.default.fileExists(atPath: destination.path) {
                try FileManager.default.removeItem(at: destination)
            }
            try FileManager.default.moveItem(at: state.fileURL, to: destination)
            resolve(body["id"], value: true)
            presentShareSheet(url: destination)
        } catch {
            try? FileManager.default.removeItem(at: state.fileURL)
            resolve(body["id"], value: false)
        }
    }

    private func cancelDownload(_ body: [String: Any]) {
        guard let ticket = body["ticket"] as? String, let state = downloads.removeValue(forKey: ticket) else {
            return
        }
        try? state.handle.close()
        try? FileManager.default.removeItem(at: state.fileURL)
    }

    // MARK: - 附件

    private func openAttachment(_ body: [String: Any]) {
        let name = Self.safeName(body["name"] as? String, fallback: "attachment")
        guard let text = body["data"] as? String, let data = Data(base64Encoded: text) else {
            presentAlert("附件内容无法读取")
            return
        }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("attachments", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let fileURL = directory.appendingPathComponent(name)
            try data.write(to: fileURL, options: .atomic)
            presentShareSheet(url: fileURL)
        } catch {
            presentAlert("附件打开失败")
        }
    }

    // MARK: - 回调网页

    private func resolve(_ id: Any?, value: Bool) {
        guard let id else {
            return
        }
        evaluate("window.__dscNativeResolve && window.__dscNativeResolve(\(Self.jsonLiteral(id)), \(value))")
    }

    private func notifyTarget(ticket: String, ok: Bool, message: String) {
        evaluate(
            "window.__deepseekDownloadTarget && window.__deepseekDownloadTarget("
                + "\(Self.jsonLiteral(ticket)), \(ok), \(Self.jsonLiteral(message)))"
        )
    }

    private func evaluate(_ script: String) {
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(script, completionHandler: nil)
        }
    }

    // MARK: - 原生界面

    private func presentShareSheet(url: URL) {
        DispatchQueue.main.async { [weak self] in
            guard let root = self?.topViewController() else {
                return
            }
            let controller = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            if let popover = controller.popoverPresentationController {
                popover.sourceView = root.view
                popover.sourceRect = CGRect(
                    x: root.view.bounds.midX, y: root.view.bounds.maxY, width: 1, height: 1
                )
                popover.permittedArrowDirections = []
            }
            root.present(controller, animated: true)
        }
    }

    private func presentAlert(_ message: String) {
        DispatchQueue.main.async { [weak self] in
            guard let root = self?.topViewController() else {
                return
            }
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "好", style: .default))
            root.present(alert, animated: true)
        }
    }

    private func topViewController() -> UIViewController? {
        guard var top = webView?.window?.rootViewController else {
            return nil
        }
        while let presented = top.presentedViewController {
            top = presented
        }
        return top
    }

    // MARK: - 工具

    private static func documentsDirectory() -> URL {
        let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    /// 只保留安全字符，避免网页传来的文件名带路径分隔符。
    private static func safeName(_ value: String?, fallback: String) -> String {
        let cleaned = (value ?? "")
            .components(separatedBy: CharacterSet(charactersIn: "/\\:*?\"<>|\n\r\t"))
            .joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmed = String(cleaned.prefix(120))
        return trimmed.isEmpty ? fallback : trimmed
    }

    /// 把任意值转成可以嵌进 JS 的 JSON 字面量。
    private static func jsonLiteral(_ value: Any) -> String {
        if let number = value as? NSNumber {
            return number.stringValue
        }
        if let text = value as? String,
           let data = try? JSONSerialization.data(withJSONObject: [text], options: []),
           let json = String(data: data, encoding: .utf8) {
            // ["..."] → 去掉外层数组，得到带引号的字符串
            let start = json.index(after: json.startIndex)
            let end = json.index(before: json.endIndex)
            return String(json[start..<end])
        }
        return "\"\""
    }
}
