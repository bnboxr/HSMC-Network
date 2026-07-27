/**
 * HSMC Mobile Wallet — App Entry Point
 * React Native bare workflow app with full wallet functionality.
 */

import React, { useEffect, useState } from 'react';
import { StatusBar, View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import AppNavigator from './src/navigation/AppNavigator';
import { useAppStore } from './src/store/appStore';
import { loadAuthData, loadWallet } from './src/services/wallet';
import { setAuth } from './src/services/api';
import { registerForPushNotifications } from './src/services/notifications';

function App(): React.JSX.Element {
  const [isReady, setIsReady] = useState(false);
  const { restoreAuth, setWallet, setOnline } = useAppStore();

  useEffect(() => {
    async function initialize() {
      try {
        // Restore auth data
        const authData = await loadAuthData();
        if (authData) {
          setAuth(authData.token, authData.userId);
          restoreAuth(authData.token, authData.userId);
        }

        // Restore wallet data
        const walletData = await loadWallet();
        if (walletData) {
          setWallet({
            id: 'local',
            address: walletData.address,
            balance: 0,
            staked_balance: 0,
            user_id: authData?.userId || '',
            label: walletData.label,
            is_primary: 1,
            created_at: walletData.createdAt,
            updated_at: new Date().toISOString(),
          });
        }

        // Register push notifications
        await registerForPushNotifications().catch(() => {
          // Non-critical, continue without push
        });

        setOnline(true);
      } catch (error) {
        console.error('App initialization error:', error);
        setOnline(false);
      } finally {
        setIsReady(true);
      }
    }

    initialize();
  }, []);

  if (!isReady) {
    return (
      <View style={styles.splash}>
        <View style={styles.logoCircle}>
          <Text style={styles.logoText}>H</Text>
        </View>
        <Text style={styles.appName}>HSMC Network</Text>
        <ActivityIndicator color="#6C5CE7" size="large" style={{ marginTop: 32 }} />
      </View>
    );
  }

  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor="#0A0A0F" />
      <AppNavigator />
    </>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: '#0A0A0F',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#6C5CE7',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  logoText: {
    fontSize: 36,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  appName: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});

export default App;
