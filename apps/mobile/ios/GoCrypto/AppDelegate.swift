import FirebaseCore
import UIKit

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    // Push notifications (Firebase Cloud Messaging). GoogleService-Info.plist is environment-specific
    // and never committed; without it the app runs normally and push registration reports
    // "not configured" instead of crashing on FirebaseApp.configure().
    if Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil {
      FirebaseApp.configure()
    }
    return true
  }
}
