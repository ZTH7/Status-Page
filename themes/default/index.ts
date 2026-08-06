import type { ThemeManifest } from '../../src/app/theme-contract'
import './theme.css'

export const theme = {
  id: 'default',
  rootClass: 'theme-default',
  supportsColorMode: true,
  decorations: {},
} satisfies ThemeManifest
