package com.deepseek.apidemo;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.WindowManager;
import android.widget.Toast;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URLDecoder;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

import org.json.JSONObject;

/**
 * Thin, dependency-free WebView shell around the bundled SPA in assets/www.
 *
 * The assets are served from https://appassets.local/ so the page gets a real
 * secure origin: localStorage, IndexedDB, service workers and CORS requests to
 * https://api.deepseek.com all behave the same way they do in a desktop browser.
 */
public class MainActivity extends Activity {

    private static final String APP_HOST = "appassets.local";
    private static final String START_URL = "https://" + APP_HOST + "/index.html";
    private static final int REQ_FILE_CHOOSER = 1001;
    private static final int REQ_CREATE_DOCUMENT = 1002;
    private static final long MAX_DOWNLOAD_BYTES = 4L * 1024 * 1024 * 1024;
    private static final int MAX_DOWNLOAD_NAME = 120;
    private static final int MAX_OPEN_ATTACHMENT_BYTES = 32 * 1024 * 1024;

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private Uri cameraCaptureUri;
    private volatile boolean trustedAppPage;
    private final Object downloadLock = new Object();
    private OutputStream downloadStream;
    private Uri downloadDocumentUri;
    private String downloadTicket;
    private long downloadWritten;
    private volatile String pendingDownloadTicket;
    private volatile String pendingDownloadName;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);

        webView = new WebView(this);
        int nightMode = getResources().getConfiguration().uiMode
                & Configuration.UI_MODE_NIGHT_MASK;
        webView.setBackgroundColor(nightMode == Configuration.UI_MODE_NIGHT_YES
                ? Color.rgb(18, 18, 18) : Color.WHITE);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setLoadsImagesAutomatically(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setTextZoom(100);

        webView.addJavascriptInterface(new AttachmentBridge(), "DeepseekNative");
        webView.setWebViewClient(new AssetClient());
        webView.setWebChromeClient(new ChromeClient());
        webView.setDownloadListener(this::onDownloadRequest);

        setContentView(webView);
        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(START_URL);
        }
    }

    private final class AttachmentBridge {

        @JavascriptInterface
        public void openAttachment(String name, String mimeType, String base64) {
            if (!trustedAppPage) {
                android.util.Log.w("DeepseekChat", "Rejected attachment request from non-app origin");
                return;
            }
            if (base64 == null || base64.length() > ((MAX_OPEN_ATTACHMENT_BYTES + 2) / 3) * 4 + 8) {
                showError("附件过大，无法在此设备上打开");
                return;
            }

            final byte[] contents;
            try {
                contents = Base64.decode(base64, Base64.DEFAULT);
            } catch (IllegalArgumentException error) {
                android.util.Log.e("DeepseekChat", "Invalid attachment data", error);
                showError("附件数据无效，无法打开");
                return;
            }
            if (contents.length > MAX_OPEN_ATTACHMENT_BYTES) {
                showError("附件过大，无法在此设备上打开");
                return;
            }

            Uri attachmentUri;
            try {
                attachmentUri = CameraCaptureProvider.createOpenAttachmentUri(
                        MainActivity.this, name, contents);
            } catch (IOException error) {
                android.util.Log.e("DeepseekChat", "Unable to prepare attachment", error);
                showError("无法准备附件");
                return;
            }

            String detectedMimeType = getContentResolver().getType(attachmentUri);
            String safeMimeType = mimeType != null
                    && mimeType.matches("[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+")
                    && !"application/octet-stream".equals(mimeType)
                    ? mimeType : "application/octet-stream";
            if ("application/octet-stream".equals(safeMimeType) && detectedMimeType != null) {
                safeMimeType = detectedMimeType;
            }
            Uri uri = attachmentUri;
            String resolvedMimeType = safeMimeType;
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(uri, resolvedMimeType);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                intent.setClipData(ClipData.newUri(
                        getContentResolver(), "Chat attachment", uri));
                try {
                    startActivity(intent);
                } catch (ActivityNotFoundException error) {
                    getContentResolver().delete(uri, null, null);
                    android.util.Log.e("DeepseekChat", "No app can open this attachment", error);
                    Toast.makeText(MainActivity.this, "没有可打开此附件的应用",
                            Toast.LENGTH_SHORT).show();
                } catch (Exception error) {
                    getContentResolver().delete(uri, null, null);
                    android.util.Log.e("DeepseekChat", "Unable to open attachment", error);
                    Toast.makeText(MainActivity.this, "无法打开附件",
                            Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public void beginDownload(String ticket, String name, String mimeType, String sizeText) {
            if (!trustedAppPage) {
                notifyDownloadTarget(ticket, false, "已拒绝非应用页面的导出请求");
                return;
            }
            if (ticket == null || ticket.isEmpty() || ticket.length() > 64) {
                return;
            }
            if (pendingDownloadTicket != null) {
                notifyDownloadTarget(ticket, false, "已有导出任务正在进行");
                return;
            }
            final String safeName = sanitizeDownloadName(name);
            final String safeMime = sanitizeMimeType(mimeType);
            pendingDownloadTicket = ticket;
            pendingDownloadName = safeName;
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType(safeMime);
                intent.putExtra(Intent.EXTRA_TITLE, safeName);
                try {
                    startActivityForResult(intent, REQ_CREATE_DOCUMENT);
                } catch (Exception error) {
                    android.util.Log.e("DeepseekChat", "Unable to open save dialog", error);
                    pendingDownloadTicket = null;
                    pendingDownloadName = null;
                    notifyDownloadTarget(ticket, false, "无法打开保存位置选择器");
                }
            });
        }

        @JavascriptInterface
        public boolean writeDownload(String ticket, String base64) {
            if (!trustedAppPage || base64 == null || base64.isEmpty()) {
                return false;
            }
            synchronized (downloadLock) {
                if (downloadStream == null || downloadTicket == null
                        || !downloadTicket.equals(ticket)) {
                    return false;
                }
                final byte[] bytes;
                try {
                    bytes = Base64.decode(base64, Base64.DEFAULT);
                } catch (IllegalArgumentException error) {
                    android.util.Log.e("DeepseekChat", "Invalid download chunk", error);
                    abandonDownloadLocked();
                    return false;
                }
                if (bytes == null || bytes.length == 0) {
                    abandonDownloadLocked();
                    return false;
                }
                if (downloadWritten + bytes.length > MAX_DOWNLOAD_BYTES) {
                    android.util.Log.e("DeepseekChat", "Download exceeds the size limit");
                    abandonDownloadLocked();
                    return false;
                }
                try {
                    downloadStream.write(bytes);
                    downloadWritten += bytes.length;
                    return true;
                } catch (IOException error) {
                    android.util.Log.e("DeepseekChat", "Unable to write download chunk", error);
                    abandonDownloadLocked();
                    return false;
                }
            }
        }

        @JavascriptInterface
        public boolean endDownload(String ticket) {
            final long written;
            final boolean closed;
            final Uri uri;
            synchronized (downloadLock) {
                if (downloadStream == null || downloadTicket == null
                        || !downloadTicket.equals(ticket)) {
                    return false;
                }
                written = downloadWritten;
                uri = downloadDocumentUri;
                closed = closeDownloadLocked();
            }
            if (closed && written > 0) {
                final String message = "已导出 " + formatBytes(written);
                runOnUiThread(() -> Toast.makeText(
                        MainActivity.this, message, Toast.LENGTH_LONG).show());
                return true;
            }
            if (uri != null) {
                try {
                    getContentResolver().delete(uri, null, null);
                } catch (Exception ignored) {
                    // 保存失败时尽量删掉半成品，删不掉也不阻断流程。
                }
            }
            return false;
        }

        @JavascriptInterface
        public void cancelDownload(String ticket) {
            synchronized (downloadLock) {
                if (downloadTicket == null || !downloadTicket.equals(ticket)) {
                    return;
                }
                abandonDownloadLocked();
            }
        }

        @JavascriptInterface
        public void showAttachmentError(String message) {
            if (!trustedAppPage) {
                return;
            }
            String safeMessage = message == null || message.isEmpty()
                    ? "无法打开附件" : message.substring(0, Math.min(message.length(), 160));
            showError(safeMessage);
        }

        private void showError(String message) {
            runOnUiThread(() -> Toast.makeText(
                    MainActivity.this, message, Toast.LENGTH_SHORT).show());
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        synchronized (downloadLock) {
            abandonDownloadLocked();
        }
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        // 先问页面：弹窗 / 浮层 / 侧栏 / 会话页都优先由 web 侧收起，再退回上一页或退出。
        final WebView view = webView;
        view.evaluateJavascript(
                "(function(){try{return window.__dscHandleBack&&window.__dscHandleBack()?'1':'0'}"
                        + "catch(e){return '0'}})()",
                value -> {
                    if ("\"1\"".equals(value)) {
                        return;
                    }
                    if (view.canGoBack()) {
                        view.goBack();
                    } else {
                        moveTaskToBack(true);
                    }
                });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_CREATE_DOCUMENT) {
            handleCreateDocumentResult(resultCode, data);
            return;
        }
        if (requestCode != REQ_FILE_CHOOSER) {
            super.onActivityResult(requestCode, resultCode, data);
            return;
        }
        Uri[] results = null;
        if (null != cameraCaptureUri) {
            try {
                File capture = CameraCaptureProvider.getCaptureFile(this, cameraCaptureUri);
                if (resultCode == Activity.RESULT_OK && capture.isFile() && capture.length() > 0) {
                    results = new Uri[]{cameraCaptureUri};
                } else {
                    deleteCameraCapture();
                }
            } catch (IOException error) {
                android.util.Log.e("DeepseekChat", "Invalid camera capture result", error);
                deleteCameraCapture();
            }
            cameraCaptureUri = null;
        } else if (resultCode == Activity.RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                int count = data.getClipData().getItemCount();
                results = new Uri[count];
                for (int i = 0; i < count; i++) {
                    results[i] = data.getClipData().getItemAt(i).getUri();
                }
            } else if (data.getData() != null) {
                results = new Uri[]{data.getData()};
            }
        }
        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
        }
    }

    private void onDownloadRequest(String url, String userAgent, String contentDisposition,
                                   String mimeType, long contentLength) {
        if (url == null) {
            return;
        }
        if (url.startsWith("blob:")) {
            if (!trustedAppPage) {
                return;
            }
            // blob: 只能由页面脚本读取，这里回交给下载桥处理。
            String suggested = suggestName(contentDisposition);
            String script = "window.__deepseekDownloadByUrl&&window.__deepseekDownloadByUrl("
                    + JSONObject.quote(url) + "," + JSONObject.quote(suggested) + ")";
            webView.post(() -> webView.evaluateJavascript(script, null));
            return;
        }
        openExternal(url);
    }

    private void openExternal(String url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (Exception error) {
            android.util.Log.e("DeepseekChat", "Unable to open download link", error);
            Toast.makeText(this, "无法打开下载链接", Toast.LENGTH_SHORT).show();
        }
    }

    private void handleCreateDocumentResult(int resultCode, Intent data) {
        final String ticket = pendingDownloadTicket;
        pendingDownloadTicket = null;
        pendingDownloadName = null;
        if (ticket == null) {
            return;
        }
        Uri uri = resultCode == Activity.RESULT_OK && data != null ? data.getData() : null;
        if (uri == null) {
            notifyDownloadTarget(ticket, false, "已取消保存");
            return;
        }
        OutputStream stream;
        try {
            stream = getContentResolver().openOutputStream(uri, "wt");
        } catch (Exception error) {
            android.util.Log.e("DeepseekChat", "Unable to create export file", error);
            stream = null;
        }
        if (stream == null) {
            notifyDownloadTarget(ticket, false, "无法创建导出文件");
            return;
        }
        synchronized (downloadLock) {
            downloadStream = stream;
            downloadDocumentUri = uri;
            downloadTicket = ticket;
            downloadWritten = 0;
        }
        notifyDownloadTarget(ticket, true, "");
    }

    private void notifyDownloadTarget(String ticket, boolean ok, String message) {
        if (ticket == null || webView == null) {
            return;
        }
        String script = "window.__deepseekDownloadTarget(" + JSONObject.quote(ticket) + ","
                + (ok ? "true" : "false") + ","
                + JSONObject.quote(message == null ? "" : message) + ")";
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    private boolean closeDownloadLocked() {
        boolean ok = true;
        if (downloadStream != null) {
            try {
                downloadStream.flush();
                downloadStream.close();
            } catch (IOException error) {
                android.util.Log.e("DeepseekChat", "Unable to close export file", error);
                ok = false;
            }
            downloadStream = null;
        }
        downloadTicket = null;
        downloadDocumentUri = null;
        downloadWritten = 0;
        return ok;
    }

    private void abandonDownloadLocked() {
        Uri uri = downloadDocumentUri;
        if (downloadStream != null) {
            try {
                downloadStream.close();
            } catch (IOException ignored) {
                // 文件已经不可写，忽略关闭异常。
            }
            downloadStream = null;
        }
        downloadTicket = null;
        downloadDocumentUri = null;
        downloadWritten = 0;
        if (uri != null) {
            try {
                getContentResolver().delete(uri, null, null);
            } catch (Exception ignored) {
                // 部分文档提供方不支持删除，忽略。
            }
        }
    }

    private static String sanitizeDownloadName(String name) {
        String value = name == null ? "" : name.trim();
        StringBuilder builder = new StringBuilder(value.length());
        for (int index = 0; index < value.length() && builder.length() < MAX_DOWNLOAD_NAME; index++) {
            char character = value.charAt(index);
            if (character == '/' || character == '\\' || character == '\0'
                    || character < 0x20 || character == 0x7f) {
                continue;
            }
            builder.append(character);
        }
        String cleaned = builder.toString().trim();
        if (cleaned.isEmpty() || ".".equals(cleaned) || "..".equals(cleaned)) {
            return "deepseek_data.zip";
        }
        return cleaned;
    }

    private static String sanitizeMimeType(String mimeType) {
        if (mimeType != null
                && mimeType.matches("[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+")) {
            return mimeType;
        }
        return "application/zip";
    }

    private static String formatBytes(long bytes) {
        if (bytes < 1024) {
            return bytes + " B";
        }
        String[] units = {"KB", "MB", "GB"};
        double value = bytes / 1024.0;
        int index = 0;
        while (value >= 1024 && index < units.length - 1) {
            value /= 1024;
            index++;
        }
        return String.format(Locale.US, "%.1f %s", value, units[index]);
    }

    private static String suggestName(String contentDisposition) {
        if (contentDisposition != null) {
            String lower = contentDisposition.toLowerCase(Locale.US);
            int index = lower.indexOf("filename*=");
            if (index >= 0) {
                String raw = contentDisposition.substring(index + 10).split(";")[0].trim();
                raw = raw.replace("\"", "");
                int separator = raw.indexOf("''");
                if (separator >= 0) {
                    raw = raw.substring(separator + 2);
                }
                try {
                    String decoded = URLDecoder.decode(raw, "UTF-8");
                    if (!decoded.isEmpty()) {
                        return decoded;
                    }
                } catch (Exception ignored) {
                    // 回退到普通 filename 分支。
                }
            }
            index = lower.indexOf("filename=");
            if (index >= 0) {
                String raw = contentDisposition.substring(index + 9).split(";")[0].trim();
                if (raw.length() > 1 && raw.startsWith("\"") && raw.endsWith("\"")) {
                    raw = raw.substring(1, raw.length() - 1);
                }
                if (!raw.isEmpty()) {
                    return raw;
                }
            }
        }
        return "deepseek_data.zip";
    }

    private final class AssetClient extends WebViewClient {

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            Uri uri = Uri.parse(url);
            trustedAppPage = "https".equals(uri.getScheme()) && APP_HOST.equals(uri.getHost());
            super.onPageStarted(view, url, favicon);
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (uri == null) {
                return null;
            }
            // 「从链接导入」：导出链接来自华为云 OBS，响应没有 CORS 头，WebView 的 fetch 会被拦。
            // 这里代理该域名的 GET，并补上 Access-Control-Allow-Origin。
            if ("GET".equalsIgnoreCase(request.getMethod()) && isExportHost(uri.getHost())) {
                WebResourceResponse proxied = proxyWithCors(uri);
                if (proxied != null) {
                    return proxied;
                }
            }
            if (!APP_HOST.equals(uri.getHost())) {
                return null;
            }
            String path = uri.getPath();
            if (path == null || path.isEmpty() || "/".equals(path)) {
                path = "/index.html";
            }
            String assetPath = "www" + path;
            try {
                InputStream in;
                try {
                    in = getAssets().open(assetPath);
                } catch (IOException notFound) {
                    // Single-page app fallback: unknown routes render the shell.
                    assetPath = "www/index.html";
                    in = getAssets().open(assetPath);
                }
                Map<String, String> headers = new HashMap<>();
                headers.put("Access-Control-Allow-Origin", "*");
                headers.put("Cache-Control", "no-cache");
                return new WebResourceResponse(
                        mimeType(assetPath), charset(assetPath), 200, "OK", headers, in);
            } catch (IOException e) {
                return null;
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (uri == null || APP_HOST.equals(uri.getHost())) {
                return false;
            }
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            } catch (Exception ignored) {
                // No browser installed / unsupported scheme: stay in the app.
            }
            return true;
        }
    }

    private final class ChromeClient extends WebChromeClient {

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                         FileChooserParams params) {
            if (cameraCaptureUri != null) {
                deleteCameraCapture();
                cameraCaptureUri = null;
            }
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(null);
            }
            filePathCallback = callback;

            if (params != null && params.isCaptureEnabled()
                    && acceptsImages(params.getAcceptTypes())) {
                launchCameraCapture();
                return true;
            }

            Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            boolean imagesOnly = acceptsImages(params == null ? null : params.getAcceptTypes());
            intent.setType(imagesOnly ? "image/*" : "*/*");
            if (params != null && params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            }
            try {
                startActivityForResult(Intent.createChooser(
                        intent, imagesOnly ? "选择图片" : "选择文件"), REQ_FILE_CHOOSER);
            } catch (Exception error) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                    filePathCallback = null;
                }
                android.util.Log.e("DeepseekChat", "Unable to open file picker", error);
                Toast.makeText(MainActivity.this, "无法打开文件选择器", Toast.LENGTH_SHORT).show();
                return true;
            }
            return true;
        }

        private void launchCameraCapture() {
            Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            try {
                cameraCaptureUri = CameraCaptureProvider.createCaptureUri(MainActivity.this);
                intent.putExtra(MediaStore.EXTRA_OUTPUT, cameraCaptureUri);
                intent.setClipData(ClipData.newRawUri("Captured photo", cameraCaptureUri));
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                        | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                startActivityForResult(intent, REQ_FILE_CHOOSER);
            } catch (Exception error) {
                deleteCameraCapture();
                cameraCaptureUri = null;
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                    filePathCallback = null;
                }
                android.util.Log.e("DeepseekChat", "Unable to open camera", error);
                Toast.makeText(MainActivity.this, "无法打开摄像头，请检查设备是否有可用相机应用",
                        Toast.LENGTH_SHORT).show();
            }
        }
    }

    private static boolean acceptsImages(String[] acceptTypes) {
        if (acceptTypes == null) {
            return false;
        }
        for (String acceptType : acceptTypes) {
            if (acceptType == null) {
                continue;
            }
            for (String type : acceptType.split("[,;]")) {
                String normalized = type.trim().toLowerCase(Locale.US);
                if ("image/*".equals(normalized) || normalized.startsWith("image/")) {
                    return true;
                }
            }
        }
        return false;
    }

    private void deleteCameraCapture() {
        if (cameraCaptureUri != null) {
            getContentResolver().delete(cameraCaptureUri, null, null);
        }
    }

    private static boolean isExportHost(String host) {
        return host != null && (host.endsWith(".myhuaweicloud.com") || host.endsWith(".huaweicloud.com"));
    }

    /** 代理导出链接并补 CORS 头；失败时返回 null，让 WebView 走原始请求（页面会提示下载失败）。 */
    private WebResourceResponse proxyWithCors(Uri uri) {
        java.net.HttpURLConnection connection = null;
        try {
            java.net.URL url = new java.net.URL(uri.toString());
            connection = (java.net.HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(30000);
            connection.setRequestMethod("GET");
            connection.setRequestProperty("Origin", "https://" + APP_HOST);
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                android.util.Log.w("DeepseekChat", "Export link returned HTTP " + status);
                connection.disconnect();
                return null;
            }
            String contentType = connection.getContentType();
            Map<String, String> headers = new HashMap<>();
            headers.put("Access-Control-Allow-Origin", "*");
            headers.put("Cache-Control", "no-store");
            String length = connection.getHeaderField("Content-Length");
            if (length != null) {
                headers.put("Content-Length", length);
            }
            return new WebResourceResponse(
                    contentType == null ? "application/zip" : contentType,
                    null, status, "OK", headers, connection.getInputStream());
        } catch (Exception error) {
            android.util.Log.e("DeepseekChat", "Unable to proxy export link", error);
            if (connection != null) {
                connection.disconnect();
            }
            return null;
        }
    }

    private static String mimeType(String path) {
        String p = path.toLowerCase(Locale.US);
        int dot = p.lastIndexOf('.');
        String ext = dot >= 0 ? p.substring(dot + 1) : "";
        switch (ext) {
            case "html": case "htm": return "text/html";
            case "js": case "mjs": return "application/javascript";
            case "css": return "text/css";
            case "json": case "map": return "application/json";
            case "txt": return "text/plain";
            case "svg": return "image/svg+xml";
            case "png": return "image/png";
            case "jpg": case "jpeg": return "image/jpeg";
            case "gif": return "image/gif";
            case "webp": return "image/webp";
            case "ico": return "image/x-icon";
            case "woff": return "font/woff";
            case "woff2": return "font/woff2";
            case "ttf": return "font/ttf";
            case "otf": return "font/otf";
            case "wasm": return "application/wasm";
            case "mp3": return "audio/mpeg";
            case "mp4": return "video/mp4";
            case "pdf": return "application/pdf";
            default: return "application/octet-stream";
        }
    }

    private static String charset(String path) {
        String mime = mimeType(path);
        if (mime.startsWith("text/") || mime.equals("application/javascript")
                || mime.equals("application/json") || mime.equals("image/svg+xml")) {
            return "utf-8";
        }
        return null;
    }
}
