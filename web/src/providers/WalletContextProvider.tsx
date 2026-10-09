import type { FC, ReactNode } from 'react';
import type { Chain } from 'viem';
import { WagmiProvider, createConfig, fallback, http } from 'wagmi';
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
import { CHAINS, robinhoodMainnet, robinhoodTestnet, rpcProxyUrl } from '../web3/chains';
import { useNetwork } from '../contexts/NetworkContext';
import { useTheme } from '../theme/ThemeProvider';
import { useI18n } from '../i18n';

// WalletConnect (mobile wallets, QR codes) needs a free project id from cloud.reown.com.
// Without one, only browser-extension wallets are offered, so no request fails with an invalid id.
const WALLETCONNECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined;
/** With WalletConnect, phone browsers can reach wallet apps from the connect modal; without it, see OpenInWallet. */
export const WALLETCONNECT_ENABLED = !!WALLETCONNECT_ID;

const connectors = connectorsForWallets(
  WALLETCONNECT_ID
    ? [
        { groupName: 'Popular', wallets: [metaMaskWallet, rabbyWallet, coinbaseWallet, walletConnectWallet] },
        { groupName: 'Other', wallets: [injectedWallet, braveWallet] },
      ]
    : [{ groupName: 'Browser wallets', wallets: [injectedWallet, rabbyWallet, braveWallet] }],
  { appName: 'HanMarket', projectId: WALLETCONNECT_ID || 'not-configured' },
);

// Reads try this site's RPC proxy first (/api/rpc, which keeps the private RPC key server-side), then the public RPCs.
// A 429, an outage, an unconfigured proxy (503) or a stall past 10 seconds on one endpoint moves the read on to the next
// instead of leaving the terminal waiting on it.
const rpcTransport = (chain: Chain, network: 'testnet' | 'mainnet') => {
  const proxy = rpcProxyUrl(network);
  const urls = [...(proxy ? [proxy] : []), ...chain.rpcUrls.default.http];
  // batches stay under the proxy's per-request cap (100 calls); viem's own default would send up to 1,000 in one
  return fallback(urls.map((url) => http(url, { batch: { batchSize: 25 }, retryCount: 1, timeout: 10_000 })), { retryCount: 1 });
};

export const wagmiConfig = createConfig({
  connectors,
  // contract reads made in the same tick go out as one Multicall3 eth_call instead of one call each
  batch: { multicall: true },
  chains: [robinhoodTestnet, robinhoodMainnet],
  transports: {
    [robinhoodTestnet.id]: rpcTransport(robinhoodTestnet, 'testnet'),
    [robinhoodMainnet.id]: rpcTransport(robinhoodMainnet, 'mainnet'),
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
  // the connect modal speaks the site's language (RainbowKit ships all five)
  const { lang } = useI18n();
  return (
    <RainbowKitProvider theme={theme} initialChain={chain} modalSize="compact" appInfo={{ appName: 'HanMarket' }} locale={lang}>
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
