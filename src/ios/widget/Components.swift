import WidgetKit
import SwiftUI

/// Wraps a widget's content with the NOS-dark/light background + the deep-link tap target.
struct NosWidgetContainer<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        Group {
            if #available(iOS 17.0, *) {
                content
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .containerBackground(Color.nosBg, for: .widget)
            } else {
                content
                    .padding()
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .background(Color.nosBg)
            }
        }
        .widgetURL(URL(string: "\(NosSharedStore.scheme())://widget/open"))
    }
}

struct LoggedOutView: View {
    var body: some View {
        Text("Por favor faça login na App")
            .font(.subheadline)
            .foregroundColor(.nosText)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// A labelled usage bar: "Dados   12,4 / 30 GB" + a green progress track.
struct UsageBar: View {
    let label: String
    let used: Double
    let total: Double
    let value: String
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label).font(.subheadline).foregroundColor(.nosText)
                Spacer()
                Text(value).font(.caption).foregroundColor(.nosMuted)
            }
            ProgressView(value: total > 0 ? min(used / total, 1.0) : 0)
                .accentColor(.nosGreen) // .tint is iOS 15+; accentColor keeps the iOS 14 floor
        }
    }
}

func nosFmt(_ d: Double) -> String {
    d == d.rounded() ? String(Int(d)) : String(format: "%.1f", d).replacingOccurrences(of: ".", with: ",")
}
