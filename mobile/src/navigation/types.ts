export type SeedConfirmationParams = {
  mnemonic: string;
  password: string;
  token?: string;
  userId?: string;
  walletAddress?: string;
};

export type RootStackParamList = {
  Welcome: undefined;
  CreateWallet: undefined;
  ImportWallet: undefined;
  SeedPhraseConfirmation: SeedConfirmationParams;
  Login: undefined;
  BiometricSetup: undefined;
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
export type MainTabParamList = {
  Dashboard: undefined;
  Send: undefined;
  Receive: undefined;
  Staking: undefined;
  Settings: undefined;
};
export type AuthStackParamList = Pick<RootStackParamList, 'Welcome' | 'CreateWallet' | 'ImportWallet' | 'SeedPhraseConfirmation' | 'Login' | 'BiometricSetup'>;
export type AppStackParamList = Pick<RootStackParamList, 'MainTabs' | 'Send' | 'Receive' | 'TransactionHistory' | 'TransactionDetail' | 'Staking' | 'Privacy' | 'HardwareWallet' | 'Settings'>;
