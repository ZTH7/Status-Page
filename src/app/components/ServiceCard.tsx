import { motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'

import type { PublicLabels } from '../../config/types'
import type { PublicMonitor } from '../../shared/api-types'
import { HistoryStrip } from './HistoryStrip'
import { StatusBadge } from './StatusBadge'

interface ServiceCardProps {
  monitor: PublicMonitor
  labels: PublicLabels
}

function firstGrapheme(value: string): string {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  return (
    Array.from(segmenter.segment(value.trim()), ({ segment }) => segment)[0] ??
    '?'
  )
}

function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp))
}

export function ServiceCard({ monitor, labels }: ServiceCardProps) {
  const shouldReduceMotion = useReducedMotion() ?? false
  const [hovered, setHovered] = useState(false)
  const [focusWithin, setFocusWithin] = useState(false)
  const lifted = hovered || focusWithin
  const latest = monitor.latest

  return (
    <motion.article
      className="service-card"
      aria-label={monitor.name}
      data-level={monitor.level}
      data-motion={shouldReduceMotion ? 'reduced' : 'full'}
      data-lifted={String(lifted)}
      initial={shouldReduceMotion ? false : { opacity: 0.96, y: 2 }}
      animate={{ opacity: 1, y: shouldReduceMotion ? 0 : lifted ? -2 : 0 }}
      transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocusWithin(true)}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget
        if (
          !(nextTarget instanceof Node) ||
          !event.currentTarget.contains(nextTarget)
        ) {
          setFocusWithin(false)
        }
      }}
    >
      <div className="service-card__identity">
        <div className="service-card__name-row">
          {monitor.presentationLogo ? (
            <img
              className="service-card__logo"
              src={monitor.presentationLogo}
              alt={`${monitor.name} logo`}
              width="40"
              height="40"
            />
          ) : (
            <span
              className="service-card__fallback"
              role="img"
              aria-label={`${monitor.name} fallback mark`}
            >
              {firstGrapheme(monitor.name)}
            </span>
          )}
          <div className="service-card__title-block">
            <h3>
              {monitor.href ? (
                <a href={monitor.href}>{monitor.name}</a>
              ) : (
                monitor.name
              )}
            </h3>
            <StatusBadge level={monitor.level} labels={labels} />
          </div>
        </div>
        {monitor.description ? <p>{monitor.description}</p> : null}
      </div>

      <dl className="service-card__metadata">
        <div>
          <dt>{labels.responseTime}</dt>
          <dd>
            {latest?.responseMs === null || !latest
              ? labels.noData
              : `${latest.responseMs} ms`}
          </dd>
        </div>
        <div>
          <dt>HTTP status</dt>
          <dd>{latest?.httpStatus ?? labels.noData}</dd>
        </div>
        <div>
          <dt>{labels.lastChecked}</dt>
          <dd>
            {latest ? (
              <time dateTime={new Date(latest.checkedAt).toISOString()}>
                {formatTimestamp(latest.checkedAt)}
              </time>
            ) : (
              labels.noData
            )}
          </dd>
        </div>
        <div>
          <dt>{labels.location}</dt>
          <dd>{latest?.location || labels.noData}</dd>
        </div>
      </dl>

      <HistoryStrip days={monitor.history} labels={labels} />
    </motion.article>
  )
}
