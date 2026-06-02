package com.nos.widgets.action

import android.content.Context
import android.content.Intent
import androidx.glance.GlanceId
import androidx.glance.action.ActionParameters
import androidx.glance.appwidget.action.ActionCallback
import com.nos.widgets.work.RefreshWorker

/**
 * In-widget refresh button. Runs in the widget process WITHOUT opening the app
 * (the key Glance capability POC #1 lacked). It kicks off a background fetch and
 * also notifies the app — if running — so JS listeners can react.
 */
class RefreshAction : ActionCallback {

    override suspend fun onAction(
        context: Context,
        glanceId: GlanceId,
        parameters: ActionParameters
    ) {
        RefreshWorker.enqueueOnce(context)

        context.sendBroadcast(
            Intent(ACTION_WIDGET_EVENT).apply {
                setPackage(context.packageName)
                putExtra("action", "refresh")
            }
        )
    }

    companion object {
        const val ACTION_WIDGET_EVENT = "com.nos.widgets.WIDGET_ACTION"
    }
}
