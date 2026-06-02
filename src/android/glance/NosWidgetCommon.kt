package com.nos.widgets.glance

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceModifier
import androidx.glance.action.actionStartActivity
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.LinearProgressIndicator
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import com.nos.widgets.store.WidgetStore
import org.json.JSONObject

/**
 * NOS palette via Android color resources with values-night/ overrides. Using
 * ColorProvider(resId) makes the widget follow the system light/dark mode live — the
 * RemoteViews resolves the @color resource against the current configuration. (Glance 1.1 has no
 * day/night ColorProvider factory, so resources are the reliable route.)
 */
class NosColors(context: Context) {
    private val ctx = context.applicationContext
    private fun cp(name: String): ColorProvider =
        ColorProvider(ctx.resources.getIdentifier(name, "color", ctx.packageName))
    val bg = cp("nos_bg")
    val surface = cp("nos_surface")
    val text = cp("nos_text")
    val muted = cp("nos_muted")
    val green = cp("nos_green")
    val track = cp("nos_track")
    val onGreen = cp("nos_on_green")
}

/** Parsed widget data from the shared store payload (see the demo app for the JSON shape). */
data class NosData(
    val loggedIn: Boolean,
    val balance: String,
    val plan: String,
    val dataUsed: Float, val dataTotal: Float, val dataUnit: String,
    val minUsed: Int, val minTotal: Int,
    val smsUsed: Int, val smsTotal: Int,
    val billAmount: String, val billDue: String
) {
    companion object {
        fun from(context: Context): NosData {
            val loggedIn = WidgetStore.isLoggedIn(context)
            val p = try { JSONObject(WidgetStore.payload(context)) } catch (e: Exception) { JSONObject() }
            val data = p.optJSONObject("data") ?: JSONObject()
            val min = p.optJSONObject("minutes") ?: JSONObject()
            val sms = p.optJSONObject("sms") ?: JSONObject()
            val bill = p.optJSONObject("bill") ?: JSONObject()
            return NosData(
                loggedIn = loggedIn,
                balance = p.optString("balance", "—"),
                plan = p.optString("plan", "NOS"),
                dataUsed = data.optDouble("used", 0.0).toFloat(),
                dataTotal = data.optDouble("total", 0.0).toFloat(),
                dataUnit = data.optString("unit", "GB"),
                minUsed = min.optInt("used", 0), minTotal = min.optInt("total", 0),
                smsUsed = sms.optInt("used", 0), smsTotal = sms.optInt("total", 0),
                billAmount = bill.optString("amount", "—"), billDue = bill.optString("due", "—")
            )
        }
    }
}

fun launchComponent(context: Context): ComponentName? =
    context.packageManager.getLaunchIntentForPackage(context.packageName)?.component

fun GlanceModifier.openApp(launch: ComponentName?): GlanceModifier =
    if (launch != null) this.clickable(actionStartActivity(launch)) else this

/** Update every placed instance of all three widgets (robust against the updateAll mapping gap). */
suspend fun updateAllNosWidgets(context: Context) {
    val mgr = GlanceAppWidgetManager(context)
    suspend fun upd(widget: GlanceAppWidget, receiver: Class<*>) {
        AppWidgetManager.getInstance(context)
            .getAppWidgetIds(ComponentName(context, receiver))
            .forEach { widget.update(context, mgr.getGlanceIdBy(it)) }
    }
    upd(SaldoWidget(), SaldoWidgetReceiver::class.java)
    upd(FaturaWidget(), FaturaWidgetReceiver::class.java)
    upd(ConsumosWidget(), ConsumosWidgetReceiver::class.java)
}

@Composable
fun LoggedOut(c: NosColors) {
    Text(
        text = "Por favor faça login na App",
        style = TextStyle(color = c.text, fontSize = 15.sp)
    )
}

/** A labelled usage bar: "Dados   12,4 / 30 GB" + a green progress track. */
@Composable
fun UsageRow(c: NosColors, label: String, used: Float, total: Float, valueText: String) {
    val pct = if (total > 0f) (used / total).coerceIn(0f, 1f) else 0f
    Column(modifier = GlanceModifier.fillMaxWidth().padding(vertical = 5.dp)) {
        Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(
                label,
                style = TextStyle(color = c.text, fontSize = 13.sp, fontWeight = FontWeight.Medium),
                modifier = GlanceModifier.defaultWeight()
            )
            Text(valueText, style = TextStyle(color = c.muted, fontSize = 13.sp))
        }
        Spacer(GlanceModifier.height(5.dp))
        LinearProgressIndicator(
            progress = pct,
            modifier = GlanceModifier.fillMaxWidth().height(7.dp),
            color = c.green,
            backgroundColor = c.track
        )
    }
}
