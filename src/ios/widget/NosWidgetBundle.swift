import WidgetKit
import SwiftUI

@main
struct NosWidgetBundle: WidgetBundle {
    var body: some Widget {
        SaldoWidget()
        FaturaWidget()
        ConsumosWidget()
        // Lock-screen / StandBy / Watch accessory widget. Included unconditionally: the extension
        // deployment target is iOS 16+, so wrapping this in `if #available` (which is unreliable for
        // widget registration in a WidgetBundle) is unnecessary.
        NosLockWidget()
    }
}
