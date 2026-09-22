import { WalletContextProvider } from '../providers/WalletContextProvider';
import { TerminalPage } from '../terminal/TerminalPage';

/** Everything wallet-related is loaded only when someone opens the terminal. */
export default function TerminalApp() {
  return (
    <WalletContextProvider>
      <TerminalPage />
    </WalletContextProvider>
  );
}
