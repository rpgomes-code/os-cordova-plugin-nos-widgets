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
import androidx.glance.layout.padding
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import com.nos.widgets.action.RefreshAction
import com.nos.widgets.work.RefreshWorker

/** Saldo — small/square: prepaid balance + plan. */
class SaldoWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val c = NosColors(context)
        val d = NosData.from(context)
        val launch = launchComponent(context)
        provideContent {
            Box(
                modifier = GlanceModifier.fillMaxSize().background(c.bg).padding(14.dp).openApp(launch),
                contentAlignment = Alignment.Center
            ) {
                if (!d.loggedIn) {
                    LoggedOut(c)
                } else {
                    Column(modifier = GlanceModifier.fillMaxSize()) {
                        Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                d.plan,
                                style = TextStyle(color = c.green, fontSize = 12.sp, fontWeight = FontWeight.Bold),
                                modifier = GlanceModifier.defaultWeight()
                            )
                            Text(
                                "⟳",
                                modifier = GlanceModifier.clickable(actionRunCallback<RefreshAction>()),
                                style = TextStyle(color = c.green, fontSize = 18.sp)
                            )
                        }
                        Spacer(GlanceModifier.defaultWeight())
                        Text(d.balance, style = TextStyle(color = c.text, fontSize = 28.sp, fontWeight = FontWeight.Bold))
                        Text("Saldo disponível", style = TextStyle(color = c.muted, fontSize = 12.sp))
                    }
                }
            }
        }
    }
}

class SaldoWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = SaldoWidget()
    override fun onEnabled(context: Context) {
        super.onEnabled(context)
        RefreshWorker.enqueuePeriodic(context)
    }
}
