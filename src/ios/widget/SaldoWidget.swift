import WidgetKit
import SwiftUI

/// Saldo — systemSmall (square): prepaid balance + plan.
struct SaldoWidget: Widget {
    let kind = "NosSaldoWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: NosProvider()) { entry in
            NosWidgetContainer { SaldoView(data: entry.data) }
        }
        .configurationDisplayName("NOS — Saldo")
        .description("O teu saldo NOS.")
        .supportedFamilies([.systemSmall])
    }
}

struct SaldoView: View {
    let data: NosData
    var body: some View {
        if !data.loggedIn {
            LoggedOutView()
        } else {
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(data.plan).font(.caption).bold().foregroundColor(.nosGreen)
                    Spacer()
                    if #available(iOS 17.0, *) {
                        Button(intent: RefreshIntent()) { Image(systemName: "arrow.clockwise") }
                            .buttonStyle(.plain).foregroundColor(.nosGreen)
                    }
                }
                Spacer()
                Text(data.balance).font(.system(size: 28, weight: .bold)).foregroundColor(.nosText)
                Text("Saldo disponível").font(.caption).foregroundColor(.nosMuted)
            }
        }
    }
}
