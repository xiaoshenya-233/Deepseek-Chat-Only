//
//  App.swift
//  Deepseek Chat Only
//
//  SwiftUI 壳：整屏只放一个 WKWebView 控制器。
//  `.ignoresSafeArea(.keyboard)` 很关键：键盘的伸缩交给原生约束（keyboardLayoutGuide）
//  和网页自己的视觉视口逻辑处理，否则 SwiftUI 会把容器整体顶上去，出现双层位移。
//

import SwiftUI

@main
struct DeepseekChatOnlyApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
                .ignoresSafeArea(.keyboard)
        }
    }
}

struct RootView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> WebViewController {
        WebViewController()
    }

    func updateUIViewController(_ controller: WebViewController, context: Context) {}
}
