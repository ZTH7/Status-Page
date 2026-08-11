import { useState } from "react";

interface ServiceIconProps {
  name: string;
  href: string | undefined;
  presentationLogo: string | undefined;
}

function firstGrapheme(value: string): string {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return Array.from(segmenter.segment(value.trim()), ({ segment }) => segment)[0] ?? "?";
}

function websiteIconUrl(href: string | undefined): string | null {
  if (!href) return null;

  try {
    return new URL("/favicon.ico", href).toString();
  } catch {
    return null;
  }
}

function iconSources(presentationLogo: string | undefined, href: string | undefined): string[] {
  const sources = presentationLogo ? [presentationLogo] : [];
  const websiteIcon = websiteIconUrl(href);

  if (websiteIcon && websiteIcon !== presentationLogo) sources.push(websiteIcon);
  return sources;
}

export function ServiceIcon({ name, href, presentationLogo }: ServiceIconProps) {
  const [sourceIndex, setSourceIndex] = useState(0);
  const source = iconSources(presentationLogo, href)[sourceIndex];

  if (!source) {
    return (
      <span className="service-card__fallback" role="img" aria-label={`${name} fallback mark`}>
        {firstGrapheme(name)}
      </span>
    );
  }

  return (
    <img
      className="service-card__logo"
      src={source}
      alt={`${name} icon`}
      width="40"
      height="40"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setSourceIndex((current) => current + 1)}
    />
  );
}
