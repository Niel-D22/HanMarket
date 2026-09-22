import type { FC, ReactNode } from 'react';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, connectorsForWallets, darkTheme, lightTheme } from '@rainbow-me/rainbowkit';
import {
  braveWallet,
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  rabbyWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets';
import '@rainbow-me/rainbowkit/styles.css';
import { CHAINS, robinhoodMainnet, robinhoodTestnet } from '../web3/chains';
import { useNetwork } from '../contexts/NetworkContext';
import { useTheme } from '../theme/ThemeProvider';

// WalletConnect (mobile wallets, QR codes) needs a free project id from cloud.reown.com.
// Without one, only browser-extension wallets are offered, so no request fails with an invalid id.
const WALLETCONNECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined;

const connectors = connectorsForWallets(
  WALLETCONNECT_ID
    ? [
        { groupName: 'Popular', wallets: [metaMaskWallet, rabbyWallet, coinbaseWallet, walletConnectWallet] },
        { groupName: 'Other', wallets: [injectedWallet, braveWallet] },
      ]
    : [{ groupName: 'Browser wallets', wallets: [injectedWallet, rabbyWallet, braveWallet] }],
  { appName: 'HanMarket', projectId: WALLETCONNECT_ID || 'not-configured' },
);

export const wagmiConfig = createConfig({
  connectors,
  chains: [robinhoodTestnet, robinhoodMainnet],
  transports: {
    [robinhoodTestnet.id]: http(undefined, { batch: true }),
    [robinhoodMainnet.id]: http(undefined, { batch: true }),
  },
});

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

// the wallet modal follows the site theme; gold from the HanMarket coin mark
const walletThemes = {
  dark: darkTheme({ accentColor: '#C9A36A', accentColorForeground: '#0B0B0C', borderRadius: 'medium', fontStack: 'system' }),
  light: lightTheme({ accentColor: '#8A6A3F', accentColorForeground: '#FFFFFF', borderRadius: 'medium', fontStack: 'system' }),
};

const InnerRainbow: FC<{ children: ReactNode }> = ({ children }) => {
  const { network } = useNetwork();
  const chain = CHAINS[network];
  const { theme: siteTheme } = useTheme();
  const theme = walletThemes[siteTheme];
  return (
    <RainbowKitProvider theme={theme} initialChain={chain} modalSize="compact" appInfo={{ appName: 'HanMarket' }}>
      {children}
    </RainbowKitProvider>
  );
};

export const WalletContextProvider: FC<{ children: ReactNode }> = ({ children }) => (
  <WagmiProvider config={wagmiConfig}>
    <QueryClientProvider client={queryClient}>
      <InnerRainbow>{children}</InnerRainbow>
    </QueryClientProvider>
  </WagmiProvider>
);
