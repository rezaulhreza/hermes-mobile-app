import { useColorScheme, useWindowDimensions } from 'react-native'

import { dark, light, type Palette, TABLET_MIN_WIDTH } from './tokens'

export function useTheme(): Palette {
  return useColorScheme() === 'dark' ? dark : light
}

export function useIsTablet(): boolean {
  return useWindowDimensions().width >= TABLET_MIN_WIDTH
}
