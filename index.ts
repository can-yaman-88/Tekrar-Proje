// The app's entry: Expo Router, plus the home-screen widget's background task.
// Android may load this file with no screen at all to draw the widget, and
// the task has to exist by then — so it is registered here, not in a screen.
import 'expo-router/entry';
import { registerHomeWidget } from './src/core/bootstrap/homeWidget';

registerHomeWidget();
