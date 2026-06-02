package com.nos.widgets.store

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONObject

/**
 * Encrypted, process-shared store for widget state.
 *
 * Written by the Cordova plugin (app process) and read by the Glance widget +
 * background worker (widget process). Replaces POC #1's unreliable static fields:
 * state survives reboots / process death because it is persisted.
 */
object WidgetStore {
    private const val FILE = "nos_widget_store"
    private const val KEY_TOKEN = "token"
    private const val KEY_PAYLOAD = "payload"
    private const val KEY_LOGGED_IN = "logged_in"
    private const val KEY_LAST_UPDATED = "last_updated"
    private const val KEY_API_BASE_URL = "api_base_url"
    private const val KEY_SCHEME = "scheme"
    private const val KEY_REFRESH_MINUTES = "refresh_minutes"

    @Volatile
    private var prefs: SharedPreferences? = null

    private fun prefs(context: Context): SharedPreferences =
        prefs ?: synchronized(this) { prefs ?: build(context).also { prefs = it } }

    private fun build(context: Context): SharedPreferences {
        val app = context.applicationContext
        val masterKey = MasterKey.Builder(app)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        return EncryptedSharedPreferences.create(
            app,
            FILE,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    fun configure(context: Context, apiBaseUrl: String?, scheme: String?, refreshMinutes: Int?) {
        prefs(context).edit().apply {
            if (apiBaseUrl != null) putString(KEY_API_BASE_URL, apiBaseUrl)
            if (scheme != null) putString(KEY_SCHEME, scheme)
            if (refreshMinutes != null && refreshMinutes > 0) putInt(KEY_REFRESH_MINUTES, refreshMinutes)
        }.apply()
    }

    fun writeData(context: Context, token: String, payload: JSONObject) {
        prefs(context).edit()
            .putString(KEY_TOKEN, token)
            .putString(KEY_PAYLOAD, payload.toString())
            .putBoolean(KEY_LOGGED_IN, token.isNotEmpty())
            .putLong(KEY_LAST_UPDATED, System.currentTimeMillis())
            .apply()
    }

    fun setPayload(context: Context, payload: String) {
        prefs(context).edit()
            .putString(KEY_PAYLOAD, payload)
            .putLong(KEY_LAST_UPDATED, System.currentTimeMillis())
            .apply()
    }

    fun setLoggedOut(context: Context) {
        prefs(context).edit()
            .putBoolean(KEY_LOGGED_IN, false)
            .putString(KEY_TOKEN, "")
            .apply()
    }

    fun token(context: Context): String = prefs(context).getString(KEY_TOKEN, "").orEmpty()
    fun payload(context: Context): String = prefs(context).getString(KEY_PAYLOAD, "{}").orEmpty()
    fun isLoggedIn(context: Context): Boolean = prefs(context).getBoolean(KEY_LOGGED_IN, false)
    fun lastUpdated(context: Context): Long = prefs(context).getLong(KEY_LAST_UPDATED, 0L)
    fun apiBaseUrl(context: Context): String = prefs(context).getString(KEY_API_BASE_URL, "").orEmpty()
    fun scheme(context: Context): String = prefs(context).getString(KEY_SCHEME, "nosapp").orEmpty()
    fun refreshMinutes(context: Context): Int = prefs(context).getInt(KEY_REFRESH_MINUTES, 30)
}
