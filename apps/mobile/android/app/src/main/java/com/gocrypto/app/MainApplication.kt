package com.gocrypto.app

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
    loadReactNative(this)
  }

  /**
   * The channel FCM notifications are posted to (its id is configured in firebase.json). Creating an
   * existing channel again is a no-op, so this is safe on every start.
   */
  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val channel =
      NotificationChannel(
          getString(R.string.default_notification_channel_id),
          getString(R.string.default_notification_channel_name),
          NotificationManager.IMPORTANCE_HIGH,
        )
        .apply {
          description = getString(R.string.default_notification_channel_description)
          enableVibration(true)
          vibrationPattern = longArrayOf(0, 180, 120, 180)
          enableLights(true)
          lightColor = ContextCompat.getColor(this@MainApplication, R.color.notification_accent)
        }
    getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
  }
}
