//
//  WebViewController.swift
//  Deepseek Chat Only
//
//  WKWebView 宿主：本地 HTTP 服务 + DeepseekNative 桥 + 文件选择 / 分享面板。
//  与 Android 壳（android/src/com/deepseek/apidemo/MainActivity.java）行为对齐：
//  离线加载打包好的 www/、保留 IndexedDB 数据、导出走原生保存。
//

import PhotosUI
import UIKit
import UniformTypeIdentifiers
import WebKit

final class WebViewController: UIViewController {
    private var webView: WKWebView!
    private let bridge = Bridge()
    private var server: LocalServer?
    private var pendingOpenPanel: (([URL]?) -> Void)?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        setUpWebView()
        startServerAndLoad()
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        // 只在本页面彻底释放时才停服务，避免切后台回来后端口失效
        if isBeingDismissed || isMovingFromParent {
            server?.stop()
            server = nil
        }
    }

    deinit {
        server?.stop()
    }

    // MARK: - 组装

    private func setUpWebView() {
        let controller = WKUserContentController()
        controller.add(bridge, name: "dscBridge")
        controller.addUserScript(
            WKUserScript(
                source: Bridge.shimScript,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = controller
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false
        webView.allowsBackForwardNavigationGestures = false
        webView.uiDelegate = self
        webView.navigationDelegate = self
        view.addSubview(webView)
        bridge.webView = webView
        self.webView = webView

        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
            // 键盘弹出时让 WKWebView 跟着缩短，网页侧的 100dvh / 输入框吸底才会跟着动
            webView.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor),
        ])
    }

    private func startServerAndLoad() {
        guard let wwwRoot = Bundle.main.url(forResource: "www", withExtension: nil) else {
            showFatal("缺少内置网页资源（www）")
            return
        }
        let server = LocalServer(root: wwwRoot)
        do {
            try server.start()
            guard let url = server.url else {
                throw LocalServer.ServerError.noPort
            }
            self.server = server
            webView.load(URLRequest(url: url))
        } catch {
            showFatal("本地服务启动失败：\(error)")
        }
    }

    private func showFatal(_ message: String) {
        let label = UILabel()
        label.translatesAutoresizingMaskIntoConstraints = false
        label.numberOfLines = 0
        label.textAlignment = .center
        label.textColor = .secondaryLabel
        label.font = .preferredFont(forTextStyle: .body)
        label.text = message
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            label.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 24),
            label.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -24),
        ])
    }
}

// MARK: - 文件选择与脚本弹窗

extension WebViewController: WKUIDelegate {
    /// <input type="file"> 的点选：WKWebView 不给 accept 过滤条件，这里让用户选「照片」或「文件」。
    func webView(
        _ webView: WKWebView,
        runOpenPanelWith parameters: WKOpenPanelParameters,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping ([URL]?) -> Void
    ) {
        guard pendingOpenPanel == nil else {
            completionHandler(nil)
            return
        }
        pendingOpenPanel = completionHandler

        let sheet = UIAlertController(title: nil, message: nil, preferredStyle: .actionSheet)
        sheet.addAction(UIAlertAction(title: "照片图库", style: .default) { [weak self] _ in
            self?.presentPhotoPicker(allowsMultiple: parameters.allowsMultipleSelection)
        })
        sheet.addAction(UIAlertAction(title: "文件", style: .default) { [weak self] _ in
            self?.presentDocumentPicker(allowsMultiple: parameters.allowsMultipleSelection)
        })
        sheet.addAction(UIAlertAction(title: "取消", style: .cancel) { [weak self] _ in
            self?.finishOpenPanel(nil)
        })
        if let popover = sheet.popoverPresentationController {
            popover.sourceView = view
            popover.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.maxY, width: 1, height: 1)
            popover.permittedArrowDirections = []
        }
        present(sheet, animated: true)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "好", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "确定", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptTextInputPanelWithPrompt prompt: String,
        defaultText: String?,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (String?) -> Void
    ) {
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        alert.addTextField { field in
            field.text = defaultText
        }
        alert.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "确定", style: .default) { [weak alert] _ in
            completionHandler(alert?.textFields?.first?.text ?? "")
        })
        present(alert, animated: true)
    }
}

// MARK: - 选择器与导航策略

extension WebViewController: PHPickerViewControllerDelegate, UIDocumentPickerDelegate {
    private func presentPhotoPicker(allowsMultiple: Bool) {
        var configuration = PHPickerConfiguration(photoLibrary: .shared())
        configuration.selectionLimit = allowsMultiple ? 0 : 1
        configuration.filter = .any(of: [.images, .videos])
        let picker = PHPickerViewController(configuration: configuration)
        picker.delegate = self
        present(picker, animated: true)
    }

    private func presentDocumentPicker(allowsMultiple: Bool) {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: true)
        picker.allowsMultipleSelection = allowsMultiple
        picker.delegate = self
        present(picker, animated: true)
    }

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        guard !results.isEmpty else {
            finishOpenPanel(nil)
            return
        }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("picked", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        let group = DispatchGroup()
        let lock = NSLock()
        var urls: [URL] = []
        for result in results {
            let provider = result.itemProvider
            // 图片优先取原始文件名（含扩展名），视频/其他回落到 public.data
            let typeIdentifier = provider.registeredTypeIdentifiers.first ?? UTType.data.identifier
            group.enter()
            provider.loadFileRepresentation(forTypeIdentifier: typeIdentifier) { url, _ in
                defer { group.leave() }
                guard let url else {
                    return
                }
                let name = provider.suggestedName.flatMap { suggested -> String? in
                    let hasExtension = (suggested as NSString).pathExtension.isEmpty == false
                    let original = (url.lastPathComponent as NSString).pathExtension
                    return hasExtension || original.isEmpty ? suggested : "\(suggested).\(original)"
                } ?? url.lastPathComponent
                let destination = Self.uniqueURL(in: directory, name: name)
                do {
                    try FileManager.default.copyItem(at: url, to: destination)
                    lock.lock()
                    urls.append(destination)
                    lock.unlock()
                } catch {}
            }
        }
        group.notify(queue: .main) { [weak self] in
            self?.finishOpenPanel(urls.isEmpty ? nil : urls)
        }
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        finishOpenPanel(urls.isEmpty ? nil : urls)
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        finishOpenPanel(nil)
    }

    private func finishOpenPanel(_ urls: [URL]?) {
        let handler = pendingOpenPanel
        pendingOpenPanel = nil
        handler?(urls)
    }

    /// 同名文件追加序号，避免多次选择同一张图互相覆盖。
    private static func uniqueURL(in directory: URL, name: String) -> URL {
        let base = (name as NSString).deletingPathExtension
        let suffix = (name as NSString).pathExtension
        var candidate = directory.appendingPathComponent(name)
        var index = 2
        while FileManager.default.fileExists(atPath: candidate.path) {
            let next = suffix.isEmpty ? "\(base)-\(index)" : "\(base)-\(index).\(suffix)"
            candidate = directory.appendingPathComponent(next)
            index += 1
        }
        return candidate
    }
}

extension WebViewController: WKNavigationDelegate {
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }
        if let host = url.host, host == "127.0.0.1" || host == "localhost" {
            decisionHandler(.allow)
            return
        }
        // 网页里的外链（引用来源、下载地址）交给系统浏览器，避免把应用页面导航走
        if navigationAction.navigationType == .linkActivated,
           let scheme = url.scheme?.lowercased(),
           scheme == "http" || scheme == "https" || scheme == "mailto" {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url, url.host != "127.0.0.1" {
            UIApplication.shared.open(url)
        }
        return nil
    }
}
