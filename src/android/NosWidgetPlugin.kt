package com.nos.widgets

import android.appwidget.AppWidgetManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import androidx.core.content.ContextCompat
import com.nos.widgets.action.RefreshAction
import com.nos.widgets.glance.ConsumosWidgetReceiver
import com.nos.widgets.glance.FaturaWidgetReceiver
import com.nos.widgets.glance.SaldoWidgetReceiver
import com.nos.widgets.glance.updateAllNosWidgets
import com.nos.widgets.store.WidgetStore
import com.nos.widgets.work.RefreshWorker
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.apache.cordova.CallbackContext
import org.apache.cordova.CordovaPlugin
import org.apache.cordova.PluginResult
import org.json.JSONArray
import org.json.JSONObject

/**
 * Cordova ⇆ native bridge (Kotlin). Exposed to OutSystems as Client Actions.
 *
 * Unlike POC #1, the widget→app event channel uses a properly registered/unregistered
 * BroadcastReceiver tied to the plugin lifecycle — no leaking static plugin instance.
 */
class NosWidgetPlugin : CordovaPlugin() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var actionCallback: CallbackContext? = null
    private var eventReceiver: BroadcastReceiver? = null

    override fun execute(
        action: String,
        args: JSONArray,
        callbackContext: CallbackContext
    ): Boolean {
        val context = cordova.activity.applicationContext

        when (action) {
            "configure" -> {
                val opts = args.optJSONObject(0) ?: JSONObject()
                WidgetStore.configure(
                    context,
                    opts.optString("apiBaseUrl").ifEmpty { null },
                    opts.optString("scheme").ifEmpty { null },
                    opts.optInt("refreshMinutes", 0).takeIf { it > 0 }
                )
                // Reschedule the background refresh so a changed interval takes effect.
                RefreshWorker.enqueuePeriodic(context)
                callbackContext.success()
            }

            "writeData" -> {
                val data = args.optJSONObject(0) ?: JSONObject()
                val token = data.optString("token", "")
                val payload = data.optJSONObject("payload") ?: JSONObject()
                WidgetStore.writeData(context, token, payload)
                android.util.Log.d("NosWidget", "plugin.writeData tokenSet=${token.isNotEmpty()} loggedIn=${WidgetStore.isLoggedIn(context)} payload=$payload")
                scope.launch {
                    try {
                        updateAllNosWidgets(context)
                        android.util.Log.d("NosWidget", "updateAll OK")
                    } catch (e: Throwable) {
                        android.util.Log.e("NosWidget", "updateAll FAILED", e)
                    }
                }
                RefreshWorker.enqueuePeriodic(context)
                callbackContext.success("written")
            }

            "refreshNow" -> {
                RefreshWorker.enqueueOnce(context)
                callbackContext.success()
            }

            "isWidgetAdded" -> {
                val mgr = AppWidgetManager.getInstance(context)
                val added = listOf(
                    SaldoWidgetReceiver::class.java,
                    FaturaWidgetReceiver::class.java,
                    ConsumosWidgetReceiver::class.java
                ).any { mgr.getAppWidgetIds(ComponentName(context, it)).isNotEmpty() }
                callbackContext.sendPluginResult(
                    PluginResult(PluginResult.Status.OK, added)
                )
            }

            "onWidgetAction" -> {
                actionCallback = callbackContext
                registerEventReceiver(context)
                val keep = PluginResult(PluginResult.Status.NO_RESULT)
                keep.keepCallback = true
                callbackContext.sendPluginResult(keep)
            }

            else -> return false
        }
        return true
    }

    private fun registerEventReceiver(context: Context) {
        if (eventReceiver != null) return
        eventReceiver = object : BroadcastReceiver() {
            override fun onReceive(c: Context?, intent: Intent?) {
                val cb = actionCallback ?: return
                val event = JSONObject().put("action", intent?.getStringExtra("action").orEmpty())
                val result = PluginResult(PluginResult.Status.OK, event)
                result.keepCallback = true
                cb.sendPluginResult(result)
            }
        }
        ContextCompat.registerReceiver(
            context,
            eventReceiver,
            IntentFilter(RefreshAction.ACTION_WIDGET_EVENT),
            ContextCompat.RECEIVER_NOT_EXPORTED
        )
    }

    override fun onDestroy() {
        super.onDestroy()
        eventReceiver?.let {
            runCatching { cordova.activity.applicationContext.unregisterReceiver(it) }
        }
        eventReceiver = null
    }
}
