// Native entry point (bare React Native). The polyfills must load before anything that uses crypto.
import './src/polyfills';
import { AppRegistry } from 'react-native';
import { name as appName } from './app.json';
import App from './src/App';
import { registerBackgroundMessageHandler } from './src/lib/push';

// Must be registered before the app component so FCM messages that wake the app in the background
// (or start it from a killed state) have a handler.
registerBackgroundMessageHandler();

AppRegistry.registerComponent(appName, () => App);
