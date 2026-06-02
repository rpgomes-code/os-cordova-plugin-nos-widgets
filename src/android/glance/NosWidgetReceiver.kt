package com.nos.widgets.glance

import android.content.Context
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import com.nos.widgets.work.RefreshWorker

/**
 * Binds the Glance widget to the AppWidget framework. Registered in the manifest
 * via plugin.xml. Schedules/cancels the periodic background refresh as the first
 * widget is added / the last is removed.
 */
class NosWidgetReceiver : GlanceAppWidgetReceiver() {

    override val glanceAppWidget: GlanceAppWidget = NosWidget()

    override fun onEnabled(context: Context) {
        super.onEnabled(context)
        RefreshWorker.enqueuePeriodic(context)
    }

    override fun onDisabled(context: Context) {
        super.onDisabled(context)
        RefreshWorker.cancelPeriodic(context)
    }
}
