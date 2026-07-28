import { registerRootComponent } from 'expo';
import { App } from './src/App';

// registerRootComponent rather than AppRegistry directly: it also sets up the
// Expo dev client and error overlay, which is the difference between a red
// screen with a stack trace and a white screen with nothing.
registerRootComponent(App);
