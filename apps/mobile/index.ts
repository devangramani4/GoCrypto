import './src/polyfills';
import { registerRootComponent } from 'expo';
import App from './src/App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App) and makes sure the
// environment is set up correctly for both Expo Go and native builds.
registerRootComponent(App);
