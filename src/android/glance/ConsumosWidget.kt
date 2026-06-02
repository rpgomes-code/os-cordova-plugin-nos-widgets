package com.nos.widgets.glance

import android.content.Context
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import com.nos.widgets.action.RefreshAction
import com.nos.widgets.work.RefreshWorker

private fun fmt(f: Float): String =
    if (f == f.toLong().toFloat()) f.toLong().toString() else f.toString().replace('.', ',')

/** Consumos — large: data / minutes / SMS usage dashboard. */
class ConsumosWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val c = NosColors(context)
        val d = NosData.from(context)
        val launch = launchComponent(context)
        provideContent {
            Box(
                modifier = GlanceModifier.fillMaxSize().background(c.bg).padding(16.dp).openApp(launch),
                contentAlignment = Alignment.Center
            ) {
                if (!d.loggedIn) {
                    LoggedOut(c)
                } else {
                    Column(modifier = GlanceModifier.fillMaxSize()) {
                        Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                "Consumos",
                                style = TextStyle(color = c.text, fontSize = 17.sp, fontWeight = FontWeight.Bold),
                                modifier = GlanceModifier.defaultWeight()
                            )
                            Text(
                                "⟳",
                                modifier = GlanceModifier.clickable(actionRunCallback<RefreshAction>()),
                                style = TextStyle(color = c.green, fontSize = 18.sp)
                            )
                        }
                        Text(d.plan, style = TextStyle(color = c.green, fontSize = 12.sp, fontWeight = FontWeight.Bold))
                        Spacer(GlanceModifier.height(10.dp))
                        UsageRow(c, "Dados", d.dataUsed, d.dataTotal, "${fmt(d.dataUsed)} / ${fmt(d.dataTotal)} ${d.dataUnit}")
                        UsageRow(c, "Minutos", d.minUsed.toFloat(), d.minTotal.toFloat(), "${d.minUsed} / ${d.minTotal} min")
                        UsageRow(c, "SMS", d.smsUsed.toFloat(), d.smsTotal.toFloat(), "${d.smsUsed} / ${d.smsTotal}")
                    }
                }
            }
        }
    }
}

class ConsumosWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = ConsumosWidget()
    override fun onEnabled(context: Context) {
        super.onEnabled(context)
        RefreshWorker.enqueuePeriodic(context)
    }
}
