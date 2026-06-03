import WidgetKit
import SwiftUI

/// Lock-screen (accessory) widget — iOS 16+. Lives in the SAME WidgetKit extension as the home-screen
/// widgets, so it needs no extra target / App ID / signing. The system renders accessory widgets
/// monochrome/vibrant, so these use no custom colours (NOS green/bg would be desaturated away).
/// Also surfaces in StandBy and as Apple Watch complications.
@available(iOS 16.0, *)
struct NosLockWidget: Widget {
    let kind = "NosLockWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: NosProvider()) { entry in
            NosLockView(data: entry.data)
                .widgetURL(URL(string: "\(NosSharedStore.scheme())://widget/open"))
        }
        .configurationDisplayName("NOS — Ecrã de bloqueio")
        .description("Saldo e consumos no ecrã de bloqueio.")
        .supportedFamilies([.accessoryInline, .accessoryCircular, .accessoryRectangular])
    }
}

@available(iOS 16.0, *)
struct NosLockView: View {
    @Environment(\.widgetFamily) private var family
    let data: NosData

    private var dataPct: Double { data.dataTotal > 0 ? min(data.dataUsed / data.dataTotal, 1.0) : 0 }

    var body: some View {
        switch family {

        // One line above the clock.
        case .accessoryInline:
            if data.loggedIn {
                Text("Saldo \(data.balance)")
            } else {
                Text("NOS — iniciar sessão")
            }

        // A data-usage ring.
        case .accessoryCircular:
            if data.loggedIn {
                Gauge(value: dataPct) {
                    Text(data.dataUnit)
                } currentValueLabel: {
                    Text(nosFmt(data.dataUsed))
                }
                .gaugeStyle(.accessoryCircular)
            } else {
                Image(systemName: "antenna.radiowaves.left.and.right.slash")
            }

        // A few compact lines (saldo + data usage).
        case .accessoryRectangular:
            if data.loggedIn {
                VStack(alignment: .leading, spacing: 2) {
                    Text(data.plan).font(.headline).widgetAccentable()
                    Text("Saldo \(data.balance)")
                    Text("Dados \(nosFmt(data.dataUsed))/\(nosFmt(data.dataTotal)) \(data.dataUnit)")
                        .font(.caption)
                }
            } else {
                Text("Inicie sessão na App NOS")
            }

        default:
            Text("NOS")
        }
    }
}
