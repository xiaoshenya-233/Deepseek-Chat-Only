package com.deepseek.apidemo;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

public final class CameraCaptureProvider extends ContentProvider {
    private static final String PATH_CAPTURE = "capture";
    private static final String PATH_OPEN = "open";
    private static final String MIME_JPEG = "image/jpeg";

    public static Uri createCaptureUri(Context context) throws IOException {
        File directory = new File(context.getCacheDir(), "camera-captures");
        if (!directory.exists() && !directory.mkdirs()) {
            throw new IOException("Unable to create camera capture directory");
        }
        File capture = new File(directory, UUID.randomUUID().toString() + ".jpg");
        if (!capture.createNewFile()) {
            throw new IOException("Unable to create camera capture file");
        }
        return new Uri.Builder()
                .scheme("content")
                .authority(context.getPackageName() + ".camera")
                .appendPath(PATH_CAPTURE)
                .appendPath(capture.getName())
                .build();
    }

    public static File getCaptureFile(Context context, Uri uri) throws IOException {
        if (uri == null || !"content".equals(uri.getScheme())
                || !(context.getPackageName() + ".camera").equals(uri.getAuthority())) {
            throw new IOException("Invalid camera capture URI");
        }
        List<String> segments = uri.getPathSegments();
        if (segments.size() != 2 || !PATH_CAPTURE.equals(segments.get(0))
                || !segments.get(1).matches("[0-9a-fA-F-]{36}\\.jpg")) {
            throw new IOException("Invalid camera capture path");
        }
        File directory = new File(context.getCacheDir(), "camera-captures").getCanonicalFile();
        File capture = new File(directory, segments.get(1)).getCanonicalFile();
        if (!capture.getPath().startsWith(directory.getPath() + File.separator)) {
            throw new IOException("Camera capture path is outside the cache directory");
        }
        return capture;
    }

    public static Uri createOpenAttachmentUri(Context context, String displayName, byte[] contents)
            throws IOException {
        File directory = new File(context.getCacheDir(), "opened-attachments");
        if (!directory.exists() && !directory.mkdirs()) {
            throw new IOException("Unable to create attachment cache directory");
        }
        File[] cachedAttachments = directory.listFiles();
        if (cachedAttachments != null) {
            long expiry = System.currentTimeMillis() - 7L * 24 * 60 * 60 * 1000;
            for (File cached : cachedAttachments) {
                if (cached.isFile()
                        && cached.getName().matches("[0-9a-fA-F-]{36}_[A-Za-z0-9._-]{1,100}")
                        && cached.lastModified() < expiry
                        && !cached.delete()) {
                    android.util.Log.w("CameraCaptureProvider",
                            "Unable to remove expired opened attachment");
                }
            }
        }
        String safeName = displayName == null
                ? "attachment" : displayName.replaceAll("[^A-Za-z0-9._-]", "_");
        safeName = safeName.replaceAll("^\\.+", "");
        if (safeName.isEmpty()) {
            safeName = "attachment";
        }
        if (safeName.length() > 100) {
            safeName = safeName.substring(safeName.length() - 100);
        }
        File attachment = new File(directory, UUID.randomUUID() + "_" + safeName);
        try (FileOutputStream output = new FileOutputStream(attachment)) {
            output.write(contents);
        } catch (IOException error) {
            if (attachment.exists() && !attachment.delete()) {
                android.util.Log.w("CameraCaptureProvider",
                        "Unable to remove incomplete attachment cache file");
            }
            throw error;
        }
        return new Uri.Builder()
                .scheme("content")
                .authority(context.getPackageName() + ".camera")
                .appendPath(PATH_OPEN)
                .appendPath(attachment.getName())
                .build();
    }

    private static File getOpenAttachmentFile(Context context, Uri uri) throws IOException {
        if (uri == null || !"content".equals(uri.getScheme())
                || !(context.getPackageName() + ".camera").equals(uri.getAuthority())) {
            throw new IOException("Invalid attachment URI");
        }
        List<String> segments = uri.getPathSegments();
        if (segments.size() != 2 || !PATH_OPEN.equals(segments.get(0))
                || !segments.get(1).matches("[0-9a-fA-F-]{36}_[A-Za-z0-9._-]{1,100}")) {
            throw new IOException("Invalid attachment path");
        }
        File directory = new File(context.getCacheDir(), "opened-attachments").getCanonicalFile();
        File attachment = new File(directory, segments.get(1)).getCanonicalFile();
        if (!attachment.getPath().startsWith(directory.getPath() + File.separator)) {
            throw new IOException("Attachment path is outside the cache directory");
        }
        return attachment;
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public String getType(Uri uri) {
        if (uri != null && !uri.getPathSegments().isEmpty()
                && PATH_OPEN.equals(uri.getPathSegments().get(0))) {
            try {
                String name = getOpenAttachmentFile(requireProviderContext(), uri).getName();
                int dot = name.lastIndexOf('.');
                String extension = dot >= 0 ? name.substring(dot + 1).toLowerCase(Locale.US) : "";
                String type = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
                return type == null ? "application/octet-stream" : type;
            } catch (IOException error) {
                return null;
            }
        }
        return MIME_JPEG;
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection,
                        String[] selectionArgs, String sortOrder) {
        String[] columns = projection != null && projection.length > 0
                ? projection : new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
        MatrixCursor cursor = new MatrixCursor(columns);
        try {
            boolean openAttachment = uri != null && !uri.getPathSegments().isEmpty()
                    && PATH_OPEN.equals(uri.getPathSegments().get(0));
            File capture = openAttachment
                    ? getOpenAttachmentFile(requireProviderContext(), uri)
                    : getCaptureFile(requireProviderContext(), uri);
            Object[] row = new Object[columns.length];
            for (int i = 0; i < columns.length; i++) {
                if (OpenableColumns.DISPLAY_NAME.equals(columns[i])) {
                    String name = capture.getName();
                    int prefixEnd = name.indexOf('_');
                    row[i] = openAttachment && prefixEnd >= 0
                            ? name.substring(prefixEnd + 1) : name;
                } else if (OpenableColumns.SIZE.equals(columns[i])) {
                    row[i] = capture.length();
                }
            }
            cursor.addRow(row);
        } catch (IOException error) {
            android.util.Log.e("CameraCaptureProvider", "Invalid capture query", error);
        }
        return cursor;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        try {
            boolean openAttachment = uri != null && !uri.getPathSegments().isEmpty()
                    && PATH_OPEN.equals(uri.getPathSegments().get(0));
            File capture = openAttachment
                    ? getOpenAttachmentFile(requireProviderContext(), uri)
                    : getCaptureFile(requireProviderContext(), uri);
            if (openAttachment && !"r".equals(mode)) {
                throw new IOException("Attachments are read-only");
            }
            int flags = "r".equals(mode)
                    ? ParcelFileDescriptor.MODE_READ_ONLY
                    : ParcelFileDescriptor.MODE_READ_WRITE
                            | ParcelFileDescriptor.MODE_CREATE
                            | ParcelFileDescriptor.MODE_TRUNCATE;
            return ParcelFileDescriptor.open(capture, flags);
        } catch (IOException error) {
            throw new FileNotFoundException(error.getMessage());
        }
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        throw new UnsupportedOperationException("Insert is not supported");
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        try {
            boolean openAttachment = uri != null && !uri.getPathSegments().isEmpty()
                    && PATH_OPEN.equals(uri.getPathSegments().get(0));
            File file = openAttachment
                    ? getOpenAttachmentFile(requireProviderContext(), uri)
                    : getCaptureFile(requireProviderContext(), uri);
            return file.delete() ? 1 : 0;
        } catch (IOException error) {
            android.util.Log.e("CameraCaptureProvider", "Unable to delete capture", error);
            return 0;
        }
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException("Update is not supported");
    }

    private Context requireProviderContext() {
        Context context = getContext();
        if (context == null) {
            throw new IllegalStateException("Camera provider is not attached");
        }
        return context;
    }
}
