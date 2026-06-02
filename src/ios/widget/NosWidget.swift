import WidgetKit
import SwiftUI

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
                            .foregroundColor(Color(red: 0, green: 0.4, blue: 0.8))
                        }
                    }
                    Spacer()
                    Text(entry.data.title.isEmpty ? "Sem dados" : entry.data.title)
                        .font(.title3).bold()
                        .foregroundColor(.black)
                    Spacer()
                }
            } else {
                Text("Por favor faça login na App")
                    .font(.headline)
                    .foregroundColor(.black)
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
                    .containerBackground(.white, for: .widget)
            } else {
                NosWidgetEntryView(entry: entry)
                    .padding()
                    .background(Color.white)
            }
        }
        .configurationDisplayName("NOS")
        .description("NOS account widget")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
