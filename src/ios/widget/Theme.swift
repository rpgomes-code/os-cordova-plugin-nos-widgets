import SwiftUI
import UIKit

/// NOS brand palette (from nos.pt) with automatic system light/dark variants.
extension UIColor {
    convenience init(nosRGB rgb: Int) {
        self.init(
            red: CGFloat((rgb >> 16) & 0xFF) / 255.0,
            green: CGFloat((rgb >> 8) & 0xFF) / 255.0,
            blue: CGFloat(rgb & 0xFF) / 255.0,
            alpha: 1.0
        )
    }
}

extension Color {
    private static func dyn(_ light: Int, _ dark: Int) -> Color {
        Color(UIColor { tc in UIColor(nosRGB: tc.userInterfaceStyle == .dark ? dark : light) })
    }
    static let nosBg = dyn(0xFFFFFF, 0x1E1F27)
    static let nosSurface = dyn(0xF2F2F4, 0x2A2A33)
    static let nosText = dyn(0x1E1F27, 0xFFFFFF)
    static let nosMuted = dyn(0x74757D, 0x94959D)
    static let nosGreen = dyn(0x6EA514, 0xBAD80A)
    static let nosTrack = dyn(0xDDDEE3, 0x404149)
    static let nosOnGreen = Color(UIColor(nosRGB: 0x1E1F27)) // dark text on the lime button
}
