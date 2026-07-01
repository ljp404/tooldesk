package com.tooldesk.app;

import android.Manifest;
import android.content.ContentUris;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "TooldeskMusic",
    permissions = {
        @Permission(strings = { Manifest.permission.READ_MEDIA_AUDIO }, alias = "audio"),
        @Permission(strings = { Manifest.permission.READ_EXTERNAL_STORAGE }, alias = "legacyAudio")
    }
)
public class TooldeskMusicPlugin extends Plugin {

    private boolean hasAudioPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return getPermissionState("audio") == PermissionState.GRANTED;
        }

        return getPermissionState("legacyAudio") == PermissionState.GRANTED;
    }

    @PluginMethod
    public void scanAudioLibrary(PluginCall call) {
        if (!hasAudioPermission()) {
            requestPermissionForAlias(
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ? "audio" : "legacyAudio",
                call,
                "audioPermissionCallback"
            );
            return;
        }

        resolveAudioLibrary(call);
    }

    @PermissionCallback
    private void audioPermissionCallback(PluginCall call) {
        if (!hasAudioPermission()) {
            call.reject("未获得音乐媒体读取权限");
            return;
        }

        resolveAudioLibrary(call);
    }

    private void resolveAudioLibrary(PluginCall call) {
        int limit = Math.max(1, Math.min(call.getInt("limit", 1000), 5000));
        JSArray tracks = new JSArray();
        Uri collection = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
        String[] projection = {
            MediaStore.Audio.Media._ID,
            MediaStore.Audio.Media.TITLE,
            MediaStore.Audio.Media.ARTIST,
            MediaStore.Audio.Media.ALBUM,
            MediaStore.Audio.Media.DISPLAY_NAME,
            MediaStore.Audio.Media.DURATION,
            MediaStore.Audio.Media.SIZE
        };
        String selection = MediaStore.Audio.Media.IS_MUSIC + " != 0";
        String sortOrder = MediaStore.Audio.Media.DATE_ADDED + " DESC";

        try (
            Cursor cursor = getContext()
                .getContentResolver()
                .query(collection, projection, selection, null, sortOrder)
        ) {
            if (cursor == null) {
                JSObject result = new JSObject();
                result.put("tracks", tracks);
                call.resolve(result);
                return;
            }

            int idColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID);
            int titleColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE);
            int artistColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST);
            int albumColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM);
            int nameColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DISPLAY_NAME);
            int durationColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION);
            int sizeColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.SIZE);

            while (cursor.moveToNext() && tracks.length() < limit) {
                long id = cursor.getLong(idColumn);
                String title = cursor.getString(titleColumn);
                String artist = cursor.getString(artistColumn);
                String album = cursor.getString(albumColumn);
                String fileName = cursor.getString(nameColumn);
                long durationMs = cursor.getLong(durationColumn);
                long size = cursor.getLong(sizeColumn);
                Uri contentUri = ContentUris.withAppendedId(collection, id);

                JSObject track = new JSObject();
                track.put("id", "android-audio-" + id);
                track.put("title", isBlank(title) ? fileName : title);
                track.put("artist", isBlank(artist) ? "未知歌手" : artist);
                track.put("album", isBlank(album) ? "" : album);
                track.put("duration", Math.round(durationMs / 1000.0));
                track.put("fileName", fileName);
                track.put("path", contentUri.toString());
                track.put("size", size);
                tracks.put(track);
            }

            JSObject result = new JSObject();
            result.put("tracks", tracks);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("读取设备音乐库失败", error);
        }
    }

    private boolean isBlank(String value) {
        return value == null || value.trim().isEmpty() || "<unknown>".equals(value);
    }
}
