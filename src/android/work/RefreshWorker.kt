package com.nos.widgets.work

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.nos.widgets.glance.NosWidget
import com.nos.widgets.store.WidgetStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit

/**
 * Background self-refresh. Runs even when the app is closed: reads the shared token,
 * fetches from the configured API, persists the payload, and re-renders the widget.
 * On 401 it drops to the logged-out state (the widget can't re-login silently).
 */
class RefreshWorker(context: Context, params: WorkerParameters) :
    CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val context = applicationContext
        val token = WidgetStore.token(context)

        if (token.isEmpty()) {
            WidgetStore.setLoggedOut(context)
            NosWidget.updateAllWidgets(context)
            return Result.success()
        }

        val url = WidgetStore.apiBaseUrl(context)
        if (url.isNotEmpty()) {
            val (code, body) = fetch(url, token)
            when {
                code in 200..299 -> WidgetStore.setPayload(context, body)
                code == 401 -> WidgetStore.setLoggedOut(context)
                else -> { /* transient: keep last good data */ }
            }
        }

        NosWidget.updateAllWidgets(context)
        return Result.success()
    }

    private suspend fun fetch(urlStr: String, token: String): Pair<Int, String> =
        withContext(Dispatchers.IO) {
            var conn: HttpURLConnection? = null
            try {
                conn = (URL(urlStr).openConnection() as HttpURLConnection).apply {
                    requestMethod = "GET"
                    connectTimeout = 10_000
                    readTimeout = 10_000
                    setRequestProperty("Authorization", "Bearer $token")
                    setRequestProperty("Accept", "application/json")
                }
                val code = conn.responseCode
                val stream = if (code in 200..299) conn.inputStream else conn.errorStream
                val body = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
                code to body
            } catch (e: Exception) {
                -1 to (e.message ?: "error")
            } finally {
                conn?.disconnect()
            }
        }

    companion object {
        private const val PERIODIC = "nos_widget_refresh_periodic"

        fun enqueuePeriodic(context: Context) {
            val request = PeriodicWorkRequestBuilder<RefreshWorker>(30, TimeUnit.MINUTES).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                PERIODIC, ExistingPeriodicWorkPolicy.UPDATE, request
            )
        }

        fun enqueueOnce(context: Context) {
            WorkManager.getInstance(context).enqueue(
                OneTimeWorkRequestBuilder<RefreshWorker>().build()
            )
        }

        fun cancelPeriodic(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(PERIODIC)
        }
    }
}
