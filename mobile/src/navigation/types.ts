/**
 * HSMC Mobile — Navigation Types
 */

export type RootStackParamList = {
  // Auth flow
  Welcome: undefined;
  CreateWallet: undefined;
  ImportWallet: undefined;
  SeedPhraseConfirmation: { mnemonic: string; password: string };
  Login: undefined;
  BiometricSetup: undefined;

  // Main app
  MainTabs: undefined;

  // Transaction flow
  Send: undefined;
  Receive: undefined;
  TransactionHistory: undefined;
  TransactionDetail: { txId: string };

  // Feature screens
  Staking: undefined;
  Privacy: undefined;
  HardwareWallet: undefined;
  Settings: undefined;
};

export type MainTabParamList = {
  Dashboard: undefined;
  Send: undefined;
  Receive: undefined;
  Staking: undefined;
  Settings: undefined;
};

export type AuthStackParamList = {
  Welcome: undefined;
  CreateWallet: undefined;
  ImportWallet: undefined;
  SeedPhraseConfirmation: { mnemonic: string; password: string };
  Login: undefined;
  BiometricSetup: undefined;
};

export type AppStackParamList = {
  MainTabs: undefined;
  Send: undefined;
  Receive: undefined;
  TransactionHistory: undefined;
  TransactionDetail: { txId: string };
  Staking: undefined;
  Privacy: undefined;
  HardwareWallet: undefined;
  Settings: undefined;
};
