/**
 * HSMC Mobile Wallet — JS entry point.
 *
 * Must be imported before anything else: @react-navigation/stack's JS-based
 * navigator requires react-native-gesture-handler to be set up first.
 */
import 'react-native-gesture-handler';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
