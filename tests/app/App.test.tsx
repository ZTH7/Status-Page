import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const motionPreference = vi.hoisted(() => ({ reduced: false }))

vi.mock('motion/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('motion/react')>()
  return { ...actual, useReducedMotion: () => motionPreference.reduced }
})

import App, { App as NamedApp } from '../../src/app/App'
import type { StatusResponse } from '../../src/shared/api-types'
import { statusResponseFixture } from '../fixtures/status-response'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function fetchStatus(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () =>
    jsonResponse(body, status),
  ) as unknown as typeof fetch
}

async function renderReady(data: StatusResponse = statusResponseFixture) {
  const rendered = render(<App fetcher={fetchStatus(data)} />)
  await screen.findByRole('heading', { level: 1, name: data.site.title })
  await waitFor(() =>
    expect(screen.getByRole('main')).not.toHaveAttribute('aria-busy', 'true'),
  )
  return rendered
}

function monitorArticle(name: string): HTMLElement {
  return screen.getByRole('article', { name })
}

beforeEach(() => {
  motionPreference.reduced = false
  window.localStorage.clear()
  delete document.documentElement.dataset.colorMode
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches: false,
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    })),
  })
})

afterEach(() => {
  document.title = ''
})

describe('App load states', () => {
  it('keeps the shared shell stable around a visibly busy loading main', () => {
    const pendingFetcher = vi.fn(
      () => new Promise<Response>(() => undefined),
    ) as unknown as typeof fetch

    render(<App fetcher={pendingFetcher} />)

    expect(App).toBe(NamedApp)
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('main', { busy: true })).toHaveTextContent(
      'Loading status…',
    )
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()
  })

  it('renders a neutral data-unavailable state instead of a monitored outage', async () => {
    render(
      <App
        fetcher={fetchStatus(
          {
            error: {
              code: 'status_unavailable',
              message: 'Status is under maintenance.',
            },
          },
          503,
        )}
      />,
    )

    const unavailable = await screen.findByRole('status', {
      name: 'Status data unavailable',
    })
    expect(unavailable).toHaveTextContent('Status is under maintenance.')
    expect(unavailable).toHaveAttribute('data-state', 'unknown')
    expect(
      screen.queryByText(statusResponseFixture.site.labels.outage),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /retry/i }),
    ).not.toBeInTheDocument()
  })
})

describe('App ready content', () => {
  it('distinguishes no configured services from a non-empty search with no matches', async () => {
    const emptyData: StatusResponse = {
      ...statusResponseFixture,
      monitors: [],
      incidents: [],
      overall: 'unknown',
    }
    const firstRender = await renderReady(emptyData)

    expect(
      screen.getByText(emptyData.site.labels.noServices),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(emptyData.site.labels.noMatches),
    ).not.toBeInTheDocument()

    firstRender.unmount()
    await renderReady()
    const searchInput = screen.getByRole('searchbox', { name: 'Search services' })
    searchInput.focus()
    fireEvent.change(
      searchInput,
      {
        target: { value: 'not-a-service' },
      },
    )

    const noMatches = screen.getByRole('status')
    expect(noMatches).toHaveTextContent(statusResponseFixture.site.labels.noMatches)
    expect(noMatches).toHaveAttribute('aria-live', 'polite')
    expect(searchInput).toHaveFocus()
    expect(
      screen.queryByText(statusResponseFixture.site.labels.noServices),
    ).not.toBeInTheDocument()
  })

  it.each([
    ['operational', 'All Systems Operational', 'Operational'],
    ['degraded', 'Some Systems Are Degraded', 'Degraded'],
    ['outage', 'Some Systems Are Unavailable', 'Outage'],
    [
      'unknown',
      'Status Is Temporarily Unknown',
      'Status Is Temporarily Unknown',
    ],
  ] as const)(
    'names the %s overall and service states without relying on color',
    async (level, overallText, serviceText) => {
      const data: StatusResponse = {
        ...statusResponseFixture,
        overall: level,
        monitors: [{ ...statusResponseFixture.monitors[0]!, level }],
      }

      await renderReady(data)

      expect(
        screen.getByRole('region', { name: overallText }),
      ).toHaveTextContent(overallText)
      expect(
        within(monitorArticle('Public API')).getByText(serviceText),
      ).toBeInTheDocument()
    },
  )

  it('uses the real slash and Escape search flow while preserving configured order', async () => {
    const user = userEvent.setup()
    await renderReady()
    const search = screen.getByRole('searchbox', { name: 'Search services' })

    expect(search).toHaveAttribute('aria-keyshortcuts', '/')
    await user.keyboard('/')
    expect(search).toHaveFocus()
    await user.type(search, 'web')
    expect(
      screen.queryByRole('article', { name: 'Public API' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('article', { name: 'Website' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(search).toHaveValue('')
    expect(search).not.toHaveFocus()
    expect(
      screen
        .getAllByRole('article')
        .map((article) => article.getAttribute('aria-label')),
    ).toEqual(['Public API', 'Website'])
  })

  it('renders link, identity, factual metadata, no-data fallbacks, and fixed image dimensions', async () => {
    const longDescription =
      'A deliberately long customer-facing description that must wrap without hiding status, metadata, or history.'
    const { href: _omittedHref, ...nonLinkableMonitor } =
      statusResponseFixture.monitors[1]!
    const data: StatusResponse = {
      ...statusResponseFixture,
      monitors: [
        {
          ...statusResponseFixture.monitors[0]!,
          description: longDescription,
          presentationLogo: '/api-mark.svg',
        },
        {
          ...nonLinkableMonitor,
          name: '👩🏽‍💻 Tools',
          latest: null,
        },
      ],
    }

    await renderReady(data)

    const linkable = monitorArticle('Public API')
    const nonLinkable = monitorArticle('👩🏽‍💻 Tools')
    expect(
      within(linkable).getByRole('link', { name: 'Public API' }),
    ).toHaveAttribute('href', 'https://api.example.test')
    expect(
      within(nonLinkable).queryByRole('link', { name: '👩🏽‍💻 Tools' }),
    ).not.toBeInTheDocument()
    expect(within(linkable).getByText(longDescription)).toBeInTheDocument()

    const monitorLogo = within(linkable).getByRole('img', {
      name: 'Public API logo',
    })
    const siteLogo = screen.getByRole('img', { name: 'Acme Status logo' })
    expect(monitorLogo).toHaveAttribute('width', '40')
    expect(monitorLogo).toHaveAttribute('height', '40')
    expect(siteLogo).toHaveAttribute('width', '32')
    expect(siteLogo).toHaveAttribute('height', '32')
    expect(
      within(nonLinkable).getByRole('img', {
        name: '👩🏽‍💻 Tools fallback mark',
      }),
    ).toHaveTextContent('👩🏽‍💻')

    expect(linkable).toHaveTextContent('842 ms')
    expect(linkable).toHaveTextContent('HTTP status')
    expect(linkable).toHaveTextContent('503')
    expect(linkable).toHaveTextContent('SJC')
    const lastCheckedValue = within(linkable).getByText(
      statusResponseFixture.site.labels.lastChecked,
    ).nextElementSibling
    expect(lastCheckedValue?.querySelector('time')).toHaveAttribute('datetime')
    expect(
      within(nonLinkable).getAllByText(
        statusResponseFixture.site.labels.noData,
      ),
    ).toHaveLength(4)
    expect(nonLinkable).not.toHaveTextContent('https://')
    expect(document.body).not.toHaveTextContent('statusText')
    expect(document.body).not.toHaveTextContent(/uptime/i)
  })

  it('shows received incident order, severity, timing, duration, recovery, escalation, and ongoing state', async () => {
    const data: StatusResponse = {
      ...statusResponseFixture,
      incidents: [
        {
          id: 'outage-1',
          monitorId: 'web',
          monitorName: 'Website',
          firstFailedAt: 1_788_558_000_000,
          degradedAt: 1_788_558_060_000,
          outageAt: 1_788_558_600_000,
          recoveredAt: 1_788_561_723_000,
          durationMs: 3_723_000,
          highestSeverity: 'outage',
        },
        {
          id: 'degraded-1',
          monitorId: 'api',
          monitorName: 'Public API',
          firstFailedAt: 1_788_559_200_000,
          degradedAt: 1_788_559_260_000,
          outageAt: null,
          recoveredAt: null,
          durationMs: 65_000,
          highestSeverity: 'degraded',
        },
      ],
    }

    await renderReady(data)

    const incidentList = screen.getByRole('list', {
      name: data.site.labels.recentIncidents,
    })
    const incidents = within(incidentList).getAllByRole('listitem')
    expect(incidents).toHaveLength(2)
    expect(incidents[0]).toHaveTextContent('Website')
    expect(incidents[0]).toHaveTextContent('Outage')
    expect(incidents[0]).toHaveTextContent(data.site.labels.startedAt)
    expect(incidents[0]).toHaveTextContent(data.site.labels.escalatedAt)
    expect(incidents[0]).toHaveTextContent(data.site.labels.recoveredAt)
    expect(incidents[0]).toHaveTextContent('1h 2m 3s')
    expect(within(incidents[0]!).getAllByRole('time')).toHaveLength(3)
    expect(incidents[1]).toHaveTextContent('Public API')
    expect(incidents[1]).toHaveTextContent('Degraded')
    expect(incidents[1]).toHaveTextContent(data.site.labels.ongoing)
    expect(incidents[1]).toHaveTextContent('1m 5s')
    expect(incidents[1]).not.toHaveTextContent(data.site.labels.escalatedAt)
  })

  it('uses the configured empty-incident copy', async () => {
    const data: StatusResponse = { ...statusResponseFixture, incidents: [] }
    await renderReady(data)

    expect(screen.getByText(data.site.labels.noIncidents)).toBeInTheDocument()
    expect(
      screen.getByRole('list', { name: data.site.labels.recentIncidents }),
    ).toBeEmptyDOMElement()
  })

  it('exposes the next color-mode action and updates the document dataset', async () => {
    const user = userEvent.setup()
    await renderReady()
    const toggle = screen.getByRole('button', { name: 'Switch to dark mode' })

    expect(toggle).toHaveTextContent('Light mode')
    expect(document.documentElement.dataset.colorMode).toBe('light')
    await user.click(toggle)

    expect(
      screen.getByRole('button', { name: 'Switch to light mode' }),
    ).toHaveTextContent('Dark mode')
    expect(document.documentElement.dataset.colorMode).toBe('dark')
  })

  it('uses the reduced-motion service-card branch while preserving hover and focus feedback state', async () => {
    motionPreference.reduced = true
    await renderReady()
    const article = monitorArticle('Public API')

    expect(article).toHaveAttribute('data-motion', 'reduced')
    expect(article).toHaveAttribute('data-lifted', 'false')
    fireEvent.mouseEnter(article)
    expect(article).toHaveAttribute('data-lifted', 'true')
    fireEvent.mouseLeave(article)
    expect(article).toHaveAttribute('data-lifted', 'false')
    fireEvent.focus(within(article).getByRole('link', { name: 'Public API' }))
    expect(article).toHaveAttribute('data-lifted', 'true')
  })

  it('sets the configured document title and keeps the exact shared semantic structure', async () => {
    await renderReady()

    expect(document.title).toBe('Acme Status')
    expect(screen.getAllByRole('banner')).toHaveLength(1)
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getByRole('region', { name: 'Services' })).toBeInTheDocument()
    expect(screen.getAllByRole('article')).toHaveLength(2)
    expect(screen.getAllByRole('list')).toHaveLength(3)
    expect(screen.getAllByRole('contentinfo')).toHaveLength(1)
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('combobox', { name: /theme/i }),
    ).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/uptime/i)

    const footer = screen.getByRole('contentinfo')
    expect(
      within(footer).getByRole('link', { name: 'Cloudflare Workers' }),
    ).toBeInTheDocument()
    expect(
      within(footer).getByRole('link', { name: 'Project source' }),
    ).toBeInTheDocument()
    expect(within(footer).getAllByRole('link')).toHaveLength(2)
  })
})
