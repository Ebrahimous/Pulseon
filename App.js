import 'react-native-gesture-handler';
import React, { useEffect } from 'react';
import { Platform, View, StyleSheet, useWindowDimensions } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { registerRootComponent } from 'expo';

import StartScreen from './src/screens/StartScreen';
import GameScreen from './src/screens/GameScreen';
import DeathScreen from './src/screens/DeathScreen';
import HowToPlayScreen from './src/screens/HowToPlayScreen';
import LeaderboardScreen from './src/screens/LeaderboardScreen';
import { useGameStore } from './src/store/gameStore';

const Stack = createNativeStackNavigator();

const PHONE_ASPECT = 390 / 844;

function WebFrame({ nav }) {
  const { width: vw, height: vh } = useWindowDimensions();
  const frameH = Math.min(vh - 16, 844);
  const frameW = Math.min(frameH * PHONE_ASPECT, vw - 16, 390);
  return (
    <View style={styles.webShell}>
      <View style={[styles.phoneFrame, { width: frameW, height: frameH }]}>
        {nav}
      </View>
    </View>
  );
}

const isWeb = Platform.OS === 'web';

function App() {
  useEffect(() => {
    useGameStore.getState().loadBestScore();
  }, []);

  const nav = (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <NavigationContainer>
        <StatusBar style="light" hidden />
        <Stack.Navigator
          initialRouteName="Start"
          screenOptions={{
            headerShown: false,
            animation: 'fade',
            contentStyle: { backgroundColor: '#000' },
          }}
        >
          <Stack.Screen name="Start"     component={StartScreen} />
          <Stack.Screen name="Game"      component={GameScreen} />
          <Stack.Screen name="Death"     component={DeathScreen} />
          <Stack.Screen name="HowToPlay"   component={HowToPlayScreen} />
          <Stack.Screen name="Leaderboard" component={LeaderboardScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </GestureHandlerRootView>
  );

  // On desktop web: center a phone-sized game window, scaled to fit viewport
  if (isWeb) {
    return <WebFrame nav={nav} />;
  }

  return nav;
}

const styles = StyleSheet.create({
  webShell: {
    flex: 1,
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  phoneFrame: {
    width: 390,
    height: 844,
    overflow: 'hidden',
    borderRadius: 12,
    boxShadow: '0 0 60px rgba(0,0,0,0.8)',
  },
});

registerRootComponent(App);
export default App;
