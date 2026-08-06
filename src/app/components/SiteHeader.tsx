import type { PublicSiteConfig } from '../../shared/api-types'
import type { ColorMode } from '../hooks/useColorMode'
import { ColorModeToggle } from './ColorModeToggle'

interface SiteHeaderProps {
  site: Pick<PublicSiteConfig, 'logo' | 'title'>
  colorMode: ColorMode
  onColorModeToggle(): void
}

export function SiteHeader({
  site,
  colorMode,
  onColorModeToggle,
}: SiteHeaderProps) {
  return (
    <header className="site-header">
      <div className="page-container site-header__inner">
        <div className="site-identity">
          <img
            src={site.logo}
            alt={`${site.title} logo`}
            width="32"
            height="32"
          />
          <h1>{site.title}</h1>
        </div>
        <ColorModeToggle colorMode={colorMode} onToggle={onColorModeToggle} />
      </div>
    </header>
  )
}
