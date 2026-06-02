import WidgetKit
import SwiftUI

/// Fatura — systemMedium (wide): next invoice amount + due date + "Pagar" deep link.
struct FaturaWidget: Widget {
    let kind = "NosFaturaWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: NosProvider()) { entry in
            NosWidgetContainer { FaturaView(data: entry.data) }
        }
        .configurationDisplayName("NOS — Fatura")
        .description("A tua próxima fatura NOS.")
        .supportedFamilies([.systemMedium])
    }
}

struct FaturaView: View {
    let data: NosData
    var body: some View {
        if !data.loggedIn {
            LoggedOutView()
        } else {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Próxima fatura").font(.subheadline).foregroundColor(.nosMuted)
                    Text(data.billAmount).font(.system(size: 30, weight: .bold)).foregroundColor(.nosText)
                    Text("Vence \(data.billDue)").font(.caption).foregroundColor(.nosMuted)
                }
                Spacer()
                Link(destination: URL(string: "\(NosSharedStore.scheme())://widget/pay")!) {
                    Text("Pagar").font(.subheadline).bold()
                        .foregroundColor(.nosOnGreen)
                        .padding(.horizontal, 18).padding(.vertical, 10)
                        .background(Color.nosGreen)
                        .clipShape(Capsule())
                }
            }
            .frame(maxHeight: .infinity)
        }
    }
}
