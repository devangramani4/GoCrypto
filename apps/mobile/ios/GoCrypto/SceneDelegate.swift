import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import UIKit

/// Brand background (#0A0D12): shown behind React Native while the first screen renders, so the
/// launch screen hands over without a white flash.
private let brandBackground = UIColor(red: 10 / 255, green: 13 / 255, blue: 18 / 255, alpha: 1)

class SceneDelegate: RCTDefaultReactNativeFactoryDelegate, UIWindowSceneDelegate {
  var window: UIWindow?
  var reactNativeFactory: RCTReactNativeFactory?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else {
      return
    }

    dependencyProvider = RCTAppDependencyProvider()
    reactNativeFactory = RCTReactNativeFactory(delegate: self)
    window = UIWindow(windowScene: windowScene)
    window?.backgroundColor = brandBackground

    #if DEBUG
    let devMenuConfiguration = RCTDevMenuConfiguration(
      devMenuEnabled: true,
      shakeGestureEnabled: true,
      keyboardShortcutsEnabled: true
    )
    reactNativeFactory?.devMenuConfiguration = devMenuConfiguration
    #endif

    // Must match AppRegistry.registerComponent in index.js (app.json "name").
    reactNativeFactory?.startReactNative(
      withModuleName: "GoCrypto",
      in: window,
      connectionOptions: connectionOptions
    )
  }

  override func customize(_ rootView: RCTRootView) {
    super.customize(rootView)
    rootView.backgroundColor = brandBackground
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    RCTLinkingManager.scene(scene, openURLContexts: URLContexts)
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    RCTLinkingManager.scene(scene, continue: userActivity)
  }

  override func bundleURL() -> URL? {
    #if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
    #else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
    #endif
  }
}
