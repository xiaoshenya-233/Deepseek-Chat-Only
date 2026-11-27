//
//  LocalServer.swift
//  Deepseek Chat Only
//
//  把打包进 App 的 www/ 通过 http://127.0.0.1:<随机端口> 提供给 WKWebView。
//
//  为什么不用 file://：WebKit 在 file:// 下不提供 IndexedDB（会话、附件都存在里面），
//  fetch 也会因来源不透明而失效。127.0.0.1 是「可信来源」，crypto.subtle、IndexedDB、
//  localStorage 都能正常工作，行为与 Electron / Android 壳一致。
//

import Foundation
import Network

final class LocalServer {
    enum ServerError: Error {
        case timeout
        case noPort
    }

    private let root: URL
    private let queue = DispatchQueue(label: "com.deepseek.chatonly.local-server")
    private var listener: NWListener?
    private(set) var port: UInt16 = 0

    init(root: URL) {
        self.root = root.standardizedFileURL
    }

    var url: URL? {
        port == 0 ? nil : URL(string: "http://127.0.0.1:\(port)/index.html")
    }

    /// 启动监听；成功后 `port` 可用。
    func start() throws {
        let parameters = NWParameters.tcp
        parameters.allowLocalEndpointReuse = true
        parameters.requiredInterfaceType = .loopback

        let listener = try NWListener(using: parameters, on: .any)
        listener.newConnectionHandler = { [weak self] connection in
            self?.handle(connection)
        }

        let ready = DispatchSemaphore(value: 0)
        listener.stateUpdateHandler = { state in
            switch state {
            case .ready, .failed, .cancelled:
                ready.signal()
            default:
                break
            }
        }
        listener.start(queue: queue)

        if ready.wait(timeout: .now() + 5) == .timedOut {
            listener.cancel()
            throw ServerError.timeout
        }
        guard let assigned = listener.port?.rawValue, assigned != 0 else {
            listener.cancel()
            throw ServerError.noPort
        }
        self.listener = listener
        self.port = assigned
    }

    func stop() {
        listener?.cancel()
        listener = nil
    }

    // MARK: - 连接处理

    private func handle(_ connection: NWConnection) {
        connection.start(queue: queue)
        receive(connection, buffer: Data())
    }

    private func receive(_ connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 128 * 1024) { [weak self] data, _, isComplete, error in
            guard let self else {
                connection.cancel()
                return
            }
            var accumulated = buffer
            if let data, !data.isEmpty {
                accumulated.append(data)
            }
            if let headerEnd = accumulated.range(of: Data("\r\n\r\n".utf8)) {
                let head = String(decoding: accumulated[..<headerEnd.lowerBound], as: UTF8.self)
                self.respond(connection, head: head)
                return
            }
            // 请求头超过 1 MB 或连接已断，直接断开，避免一直占着内存
            if error != nil || isComplete || accumulated.count > 1 << 20 {
                connection.cancel()
                return
            }
            self.receive(connection, buffer: accumulated)
        }
    }

    private func respond(_ connection: NWConnection, head: String) {
        let lines = head.split(separator: "\r\n", omittingEmptySubsequences: false)
        guard let requestLine = lines.first else {
            connection.cancel()
            return
        }
        let parts = requestLine.split(separator: " ")
        guard parts.count >= 2 else {
            connection.cancel()
            return
        }
        let method = String(parts[0]).uppercased()
        guard method == "GET" || method == "HEAD" else {
            notFound(connection, headOnly: false, status: "405 Method Not Allowed")
            return
        }

        var path = String(parts[1])
        if let cut = path.firstIndex(where: { $0 == "?" || $0 == "#" }) {
            path = String(path[..<cut])
        }
        let decoded = path.removingPercentEncoding ?? path
        let relative = decoded == "/" || decoded.isEmpty ? "index.html" : String(decoded.drop { $0 == "/" })

        guard let fileURL = resolve(relative),
              let body = try? Data(contentsOf: fileURL, options: .mappedIfSafe) else {
            notFound(connection, headOnly: method == "HEAD")
            return
        }
        send(connection, status: "200 OK", type: Self.mimeType(for: fileURL.pathExtension),
             body: body, headOnly: method == "HEAD")
    }

    private func notFound(_ connection: NWConnection, headOnly: Bool, status: String = "404 Not Found") {
        send(connection, status: status, type: "text/plain; charset=utf-8",
             body: Data("Not Found".utf8), headOnly: headOnly)
    }

    /// 把请求路径解析到 Bundle 内的真实文件；目录优先 index.html，越界一律拒绝。
    private func resolve(_ relative: String) -> URL? {
        let candidate = root.appendingPathComponent(relative).standardizedFileURL
        guard candidate.path == root.path || candidate.path.hasPrefix(root.path + "/") else {
            return nil
        }
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: candidate.path, isDirectory: &isDirectory) else {
            return nil
        }
        if isDirectory.boolValue {
            let index = candidate.appendingPathComponent("index.html")
            return FileManager.default.fileExists(atPath: index.path) ? index : nil
        }
        return candidate
    }

    private func send(_ connection: NWConnection, status: String, type: String, body: Data, headOnly: Bool) {
        let head = "HTTP/1.1 \(status)\r\n"
            + "Content-Type: \(type)\r\n"
            + "Content-Length: \(body.count)\r\n"
            + "Cache-Control: no-cache\r\n"
            + "Connection: close\r\n\r\n"
        var payload = Data(head.utf8)
        if !headOnly {
            payload.append(body)
        }
        connection.send(content: payload, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }

    private static func mimeType(for pathExtension: String) -> String {
        switch pathExtension.lowercased() {
        case "html", "htm":
            return "text/html; charset=utf-8"
        case "js", "mjs":
            return "text/javascript; charset=utf-8"
        case "css":
            return "text/css; charset=utf-8"
        case "json", "map":
            return "application/json; charset=utf-8"
        case "svg":
            return "image/svg+xml"
        case "png":
            return "image/png"
        case "jpg", "jpeg":
            return "image/jpeg"
        case "gif":
            return "image/gif"
        case "webp":
            return "image/webp"
        case "ico":
            return "image/x-icon"
        case "woff":
            return "font/woff"
        case "woff2":
            return "font/woff2"
        case "ttf":
            return "font/ttf"
        case "otf":
            return "font/otf"
        case "wasm":
            return "application/wasm"
        case "mp4", "m4v":
            return "video/mp4"
        case "m4a":
            return "audio/mp4"
        case "mp3":
            return "audio/mpeg"
        case "webm":
            return "video/webm"
        case "pdf":
            return "application/pdf"
        case "zip":
            return "application/zip"
        case "txt", "md", "log":
            return "text/plain; charset=utf-8"
        default:
            return "application/octet-stream"
        }
    }
}
