import WidgetKit
import SwiftUI

/// NOS brand palette (from nos.pt).
private extension Color {
    static let nosDark = Color(red: 30 / 255, green: 31 / 255, blue: 39 / 255)    // #1E1F27
    static let nosGreen = Color(red: 186 / 255, green: 216 / 255, blue: 10 / 255) // #BAD80A
}

/// The widget UI — 100% SwiftUI/Swift. Two states from the App Group store:
///  - logged out: a "please log in" prompt (tap opens the app via widgetURL)
///  - logged in:  the pushed title + (iOS 17+) an interactive refresh button
struct NosWidgetEntryView: View {
    var entry: NosProvider.Entry

    var body: some View {
        Group {
            if entry.data.loggedIn {
                VStack {
                    HStack {
                        Spacer()
                        if #available(iOS 17.0, *) {
                            Button(intent: RefreshIntent()) {
                                Image(systemName: "arrow.clockwise")
                            }
                            .buttonStyle(.plain)
                            .foregroundColor(.nosGreen)
                        }
                    }
                    Spacer()
                    Text(entry.data.title.isEmpty ? "Sem dados" : entry.data.title)
                        .font(.title3).bold()
                        .foregroundColor(.white)
                    Spacer()
                }
            } else {
                Text("Por favor faça login na App")
                    .font(.headline)
                    .foregroundColor(.white)
                    .multilineTextAlignment(.center)
            }
        }
        .widgetURL(URL(string: "\(NosSharedStore.scheme())://widget/open"))
    }
}

struct NosWidget: Widget {
    let kind = "NosWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: NosProvider()) { entry in
            if #available(iOS 17.0, *) {
                NosWidgetEntryView(entry: entry)
                    .containerBackground(Color.nosDark, for: .widget)
            } else {
                NosWidgetEntryView(entry: entry)
                    .padding()
                    .background(Color.nosDark)
            }
        }
        .configurationDisplayName("NOS")
        .description("NOS account widget")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
