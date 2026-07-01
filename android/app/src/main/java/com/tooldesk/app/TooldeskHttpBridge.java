package com.tooldesk.app;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

public class TooldeskHttpBridge {

    private final Activity activity;
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final WebView webView;

    public TooldeskHttpBridge(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
    }

    @JavascriptInterface
    public void request(String requestId, String payloadJson) {
        executor.execute(() -> executeRequest(requestId, payloadJson));
    }

    @JavascriptInterface
    public void saveImageToGallery(String requestId, String payloadJson) {
        executor.execute(() -> executeSaveImageToGallery(requestId, payloadJson));
    }

    private void executeRequest(String requestId, String payloadJson) {
        long startedAt = System.currentTimeMillis();
        HttpURLConnection connection = null;

        try {
            JSONObject payload = new JSONObject(payloadJson == null ? "{}" : payloadJson);
            String targetUrl = payload.optString("url", "");
            String method = payload.optString("method", "GET").toUpperCase(Locale.ROOT);
            int timeoutMs = Math.max(1, payload.optInt("timeoutMs", 30000));

            if (targetUrl.trim().isEmpty()) {
                resolve(requestId, createErrorResponse("Missing request url", startedAt));
                return;
            }

            connection = (HttpURLConnection) new URL(targetUrl).openConnection();
            connection.setRequestMethod(method);
            connection.setConnectTimeout(timeoutMs);
            connection.setReadTimeout(timeoutMs);
            connection.setInstanceFollowRedirects(true);

            JSONObject headers = payload.optJSONObject("headers");
            if (headers != null) {
                Iterator<String> headerKeys = headers.keys();
                while (headerKeys.hasNext()) {
                    String key = headerKeys.next();
                    connection.setRequestProperty(key, String.valueOf(headers.opt(key)));
                }
            }

            String body = payload.optString("body", null);
            if (body != null && methodAllowsBody(method)) {
                byte[] bodyBytes = body.getBytes(StandardCharsets.UTF_8);
                connection.setDoOutput(true);
                connection.setFixedLengthStreamingMode(bodyBytes.length);
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(bodyBytes);
                }
            }

            int status = connection.getResponseCode();
            InputStream input = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            byte[] responseBytes = readAllBytes(input);
            JSONObject responseHeaders = normalizeHeaders(connection.getHeaderFields());
            String contentType = connection.getContentType() == null ? "" : connection.getContentType();
            boolean textResponse = isTextResponse(contentType);
            String responseBody = textResponse
                ? new String(responseBytes, StandardCharsets.UTF_8)
                : Base64.encodeToString(responseBytes, Base64.NO_WRAP);

            JSONObject result = new JSONObject();
            result.put("body", responseBody);
            result.put("bodyByteLength", responseBytes.length);
            result.put("bodyEncoding", textResponse ? "utf-8" : "base64");
            result.put("durationMs", System.currentTimeMillis() - startedAt);
            result.put("headers", responseHeaders);
            result.put("ok", status >= 200 && status < 300);
            result.put("status", status);
            result.put("statusText", connection.getResponseMessage() == null ? "" : connection.getResponseMessage());
            resolve(requestId, result);
        } catch (Exception error) {
            resolve(requestId, createErrorResponse(error.getMessage() == null ? "Request failed" : error.getMessage(), startedAt));
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private void executeSaveImageToGallery(String requestId, String payloadJson) {
        try {
            JSONObject payload = new JSONObject(payloadJson == null ? "{}" : payloadJson);
            String dataUrl = payload.optString("dataUrl", "");
            String fileName = sanitizeFileName(payload.optString("fileName", "tooldesk-image.png"));
            String base64 = dataUrl.contains(",") ? dataUrl.substring(dataUrl.indexOf(',') + 1) : dataUrl;
            byte[] imageBytes = Base64.decode(base64, Base64.DEFAULT);

            if (imageBytes.length == 0) {
            resolveGallery(requestId, createGalleryResult(false, "", "图片内容为空"));
                return;
            }

            ContentResolver resolver = activity.getContentResolver();
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, fileName);
            values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Tooldesk");
                values.put(MediaStore.Images.Media.IS_PENDING, 1);
            }

            Uri uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);

            if (uri == null) {
                resolveGallery(requestId, createGalleryResult(false, "", "无法创建相册文件"));
                return;
            }

            try (OutputStream output = resolver.openOutputStream(uri)) {
                if (output == null) {
                    resolveGallery(requestId, createGalleryResult(false, "", "无法写入相册文件"));
                    return;
                }

                output.write(imageBytes);
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues doneValues = new ContentValues();
                doneValues.put(MediaStore.Images.Media.IS_PENDING, 0);
                resolver.update(uri, doneValues, null, null);
            }

            resolveGallery(requestId, createGalleryResult(true, uri.toString(), ""));
        } catch (Exception error) {
            resolveGallery(requestId, createGalleryResult(false, "", error.getMessage() == null ? "保存失败" : error.getMessage()));
        }
    }

    private void resolve(String requestId, JSONObject result) {
        String script = "window.__tooldeskHttpResolve && window.__tooldeskHttpResolve(" +
            JSONObject.quote(requestId == null ? "" : requestId) +
            "," +
            result.toString() +
            ");";

        activity.runOnUiThread(() -> webView.evaluateJavascript(script, null));
    }

    private void resolveGallery(String requestId, JSONObject result) {
        String script = "window.__tooldeskGalleryResolve && window.__tooldeskGalleryResolve(" +
            JSONObject.quote(requestId == null ? "" : requestId) +
            "," +
            result.toString() +
            ");";

        activity.runOnUiThread(() -> webView.evaluateJavascript(script, null));
    }

    private static boolean methodAllowsBody(String method) {
        return "POST".equals(method) || "PUT".equals(method) || "PATCH".equals(method) || "DELETE".equals(method);
    }

    private static boolean isTextResponse(String contentType) {
        String normalized = contentType.toLowerCase(Locale.ROOT);
        return normalized.contains("application/json") ||
            normalized.contains("text/") ||
            normalized.contains("application/javascript") ||
            normalized.contains("application/xml");
    }

    private static byte[] readAllBytes(InputStream input) throws Exception {
        if (input == null) {
            return new byte[0];
        }

        try (InputStream stream = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = stream.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
            return output.toByteArray();
        }
    }

    private static JSONObject normalizeHeaders(Map<String, List<String>> fields) throws Exception {
        JSONObject headers = new JSONObject();
        if (fields == null) {
            return headers;
        }

        for (Map.Entry<String, List<String>> entry : fields.entrySet()) {
            String key = entry.getKey();
            List<String> value = entry.getValue();
            if (key != null && value != null && !value.isEmpty()) {
                headers.put(key, String.join(", ", value));
            }
        }
        return headers;
    }

    private static JSONObject createErrorResponse(String message, long startedAt) {
        JSONObject result = new JSONObject();
        try {
            result.put("body", "");
            result.put("bodyByteLength", 0);
            result.put("bodyEncoding", "utf-8");
            result.put("durationMs", System.currentTimeMillis() - startedAt);
            result.put("error", message);
            result.put("headers", new JSONObject());
            result.put("ok", false);
            result.put("status", 0);
            result.put("statusText", "");
        } catch (Exception ignored) {
        }
        return result;
    }

    private static JSONObject createGalleryResult(boolean ok, String uri, String error) {
        JSONObject result = new JSONObject();
        try {
            result.put("ok", ok);
            result.put("uri", uri);
            result.put("error", error);
        } catch (Exception ignored) {
        }
        return result;
    }

    private static String sanitizeFileName(String value) {
        String name = value == null ? "" : value.trim().replaceAll("[\\\\/:*?\"<>|]", "-");
        if (name.isEmpty()) {
            return "tooldesk-image.png";
        }
        return name.toLowerCase(Locale.ROOT).endsWith(".png") ? name : name + ".png";
    }
}
