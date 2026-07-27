/**
 * HSMC Mobile — App Navigator
 * Root navigator that switches between Auth flow and Main App.
 */

import React from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { RootStackParamList, MainTabParamList } from './types';
import { useAppStore } from '../store/appStore';

// Screens
import WelcomeScreen from '../screens/WelcomeScreen';
import CreateWalletScreen from '../screens/CreateWalletScreen';
import ImportWalletScreen from '../screens/ImportWalletScreen';
import SeedPhraseConfirmationScreen from '../screens/SeedPhraseConfirmationScreen';
import LoginScreen from '../screens/LoginScreen';
import BiometricSetupScreen from '../screens/BiometricSetupScreen';
import DashboardScreen from '../screens/DashboardScreen';
import SendScreen from '../screens/SendScreen';
import ReceiveScreen from '../screens/ReceiveScreen';
import TransactionHistoryScreen from '../screens/TransactionHistoryScreen';
import TransactionDetailScreen from '../screens/TransactionDetailScreen';
import StakingScreen from '../screens/StakingScreen';
import PrivacyScreen from '../screens/PrivacyScreen';
import HardwareWalletScreen from '../screens/HardwareWalletScreen';
import SettingsScreen from '../screens/SettingsScreen';

const RootStack = createStackNavigator<RootStackParamList>();
const MainTab = createBottomTabNavigator<MainTabParamList>();

// ─── HSMC Dark Theme ────────────────────────────────────────────────────────

const HSMCTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: '#6C5CE7',
    background: '#0A0A0F',
    card: '#151520',
    text: '#FFFFFF',
    border: '#2A2A35',
    notification: '#FF6B6B',
  },
};

// ─── Main Tab Navigator ─────────────────────────────────────────────────────

function MainTabNavigator(): React.JSX.Element {
  return (
    <MainTab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#151520',
          borderTopColor: '#2A2A35',
          borderTopWidth: 1,
          height: 60,
          paddingBottom: 8,
          paddingTop: 8,
        },
        tabBarActiveTintColor: '#6C5CE7',
        tabBarInactiveTintColor: '#666680',
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
      }}
    >
      <MainTab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{
          tabBarLabel: 'Wallet',
          tabBarIcon: ({ color }) => null, // Vector icons placeholder
        }}
      />
      <MainTab.Screen
        name="Send"
        component={SendScreen}
        options={{
          tabBarLabel: 'Send',
          tabBarIcon: ({ color }) => null,
        }}
      />
      <MainTab.Screen
        name="Receive"
        component={ReceiveScreen}
        options={{
          tabBarLabel: 'Receive',
          tabBarIcon: ({ color }) => null,
        }}
      />
      <MainTab.Screen
        name="Staking"
        component={StakingScreen}
        options={{
          tabBarLabel: 'Staking',
          tabBarIcon: ({ color }) => null,
        }}
      />
      <MainTab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          tabBarLabel: 'Settings',
          tabBarIcon: ({ color }) => null,
        }}
      />
    </MainTab.Navigator>
  );
}

// ─── Root Navigator ─────────────────────────────────────────────────────────

export default function AppNavigator(): React.JSX.Element {
  const isLoggedIn = useAppStore((state) => state.isLoggedIn);

  return (
    <NavigationContainer theme={HSMCTheme}>
      <RootStack.Navigator
        screenOptions={{
          headerShown: false,
          cardStyle: { backgroundColor: '#0A0A0F' },
          gestureEnabled: false,
        }}
      >
        {!isLoggedIn ? (
          // Auth flow
          <>
            <RootStack.Screen name="Welcome" component={WelcomeScreen} />
            <RootStack.Screen name="CreateWallet" component={CreateWalletScreen} />
            <RootStack.Screen name="ImportWallet" component={ImportWalletScreen} />
            <RootStack.Screen name="SeedPhraseConfirmation" component={SeedPhraseConfirmationScreen} />
            <RootStack.Screen name="Login" component={LoginScreen} />
            <RootStack.Screen name="BiometricSetup" component={BiometricSetupScreen} />
          </>
        ) : (
          // Main app
          <>
            <RootStack.Screen name="MainTabs" component={MainTabNavigator} />
            <RootStack.Screen name="TransactionHistory" component={TransactionHistoryScreen} />
            <RootStack.Screen name="TransactionDetail" component={TransactionDetailScreen} />
            <RootStack.Screen name="Privacy" component={PrivacyScreen} />
            <RootStack.Screen name="HardwareWallet" component={HardwareWalletScreen} />
          </>
        )}
      </RootStack.Navigator>
    </NavigationContainer>
  );
}
