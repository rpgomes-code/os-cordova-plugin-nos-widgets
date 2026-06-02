import WidgetKit
import SwiftUI

/// Consumos — systemLarge: data / minutes / SMS usage dashboard.
struct ConsumosWidget: Widget {
    let kind = "NosConsumosWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: NosProvider()) { entry in
            NosWidgetContainer { ConsumosView(data: entry.data) }
        }
        .configurationDisplayName("NOS — Consumos")
        .description("Dados, minutos e SMS.")
        .supportedFamilies([.systemLarge])
    }
}

struct ConsumosView: View {
    let data: NosData
    var body: some View {
        if !data.loggedIn {
            LoggedOutView()
        } else {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("Consumos").font(.headline).foregroundColor(.nosText)
                    Spacer()
                    if #available(iOS 17.0, *) {
                        Button(intent: RefreshIntent()) { Image(systemName: "arrow.clockwise") }
                            .buttonStyle(.plain).foregroundColor(.nosGreen)
                    }
                }
                Text(data.plan).font(.caption).bold().foregroundColor(.nosGreen)
                UsageBar(label: "Dados", used: data.dataUsed, total: data.dataTotal,
                         value: "\(nosFmt(data.dataUsed)) / \(nosFmt(data.dataTotal)) \(data.dataUnit)")
                UsageBar(label: "Minutos", used: Double(data.minUsed), total: Double(data.minTotal),
                         value: "\(data.minUsed) / \(data.minTotal) min")
                UsageBar(label: "SMS", used: Double(data.smsUsed), total: Double(data.smsTotal),
                         value: "\(data.smsUsed) / \(data.smsTotal)")
                Spacer()
            }
        }
    }
}
