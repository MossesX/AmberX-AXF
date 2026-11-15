/** The default-asset overrides of the settings interface a component is drawn in (quick-settings@1; {} = follow the console). */
import { createContext, useContext } from 'react';

export const QuickAssetsContext = createContext<Record<string, string>>({});
/** The asset id this settings interface overrides for a type (undefined = the console's default). */
export function useQuickAsset(type: string): string | undefined { return useContext(QuickAssetsContext)[type]; }
