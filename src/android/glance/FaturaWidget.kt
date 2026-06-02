package com.nos.widgets.glance

import android.content.Context
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import com.nos.widgets.work.RefreshWorker

/** Fatura — medium/wide: next invoice amount + due date + "Pagar" action. */
class FaturaWidget : GlanceAppWidget() {
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
                    Row(modifier = GlanceModifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
                        Column(modifier = GlanceModifier.defaultWeight()) {
                            Text("Próxima fatura", style = TextStyle(color = c.muted, fontSize = 13.sp))
                            Spacer(GlanceModifier.height(4.dp))
                            Text(d.billAmount, style = TextStyle(color = c.text, fontSize = 30.sp, fontWeight = FontWeight.Bold))
                            Text("Vence ${d.billDue}", style = TextStyle(color = c.muted, fontSize = 13.sp))
                        }
                        Box(
                            modifier = GlanceModifier
                                .background(c.green)
                                .cornerRadius(12.dp)
                                .padding(horizontal = 18.dp, vertical = 12.dp)
                                .openApp(launch),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                "Pagar",
                                style = TextStyle(color = c.onGreen, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                            )
                        }
                    }
                }
            }
        }
    }
}

class FaturaWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = FaturaWidget()
    override fun onEnabled(context: Context) {
        super.onEnabled(context)
        RefreshWorker.enqueuePeriodic(context)
    }
}
