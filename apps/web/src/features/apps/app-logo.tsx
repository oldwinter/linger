import { PlugSocketIcon } from "@hugeicons/core-free-icons";
import { useEffect, useRef, useState } from "react";

import { Icon } from "@/components/ui/icon";
import { useT } from "@/i18n/use-translation";
import { cn } from "@/lib/cn";

import { connectorMessages as m } from "./connectors.messages";

const SIZES = {
  md: { image: "size-6", icon: 20 },
  sm: { image: "size-3", icon: 12 },
  profile: { image: "size-4", icon: 15 },
} as const;

export function AppLogo({
  name,
  size = "md",
  url,
}: {
  name: string;
  size?: keyof typeof SIZES;
  url?: string;
}) {
  const t = useT();
  const [failedUrl, setFailedUrl] = useState<string>();
  const [loadedUrl, setLoadedUrl] = useState<string>();
  const imgRef = useRef<HTMLImageElement>(null);
  const showImage = Boolean(url) && failedUrl !== url;
  const loaded = Boolean(url) && loadedUrl === url;

  useEffect(() => {
    const node = imgRef.current;
    if (url && node?.complete && node.naturalWidth > 0) {
      setLoadedUrl(url);
    }
  }, [url]);

  if (!showImage || !url) {
    return (
      <span
        aria-label={t(m.appIcon, { name })}
        className="inline-flex items-center justify-center text-muted-foreground"
        role="img"
      >
        <Icon icon={PlugSocketIcon} size={SIZES[size].icon} />
      </span>
    );
  }

  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center",
        SIZES[size].image,
      )}
    >
      {!loaded ? (
        <span
          aria-hidden="true"
          className="inline-flex items-center justify-center text-muted-foreground/60"
          data-logo-fallback="loading"
        >
          <Icon icon={PlugSocketIcon} size={SIZES[size].icon} />
        </span>
      ) : null}
      <img
        alt=""
        className={cn(
          SIZES[size].image,
          "object-contain transition-opacity duration-150 motion-reduce:transition-none",
          loaded ? "opacity-100" : "absolute inset-0 opacity-0",
        )}
        onError={() => setFailedUrl(url)}
        onLoad={() => setLoadedUrl(url)}
        ref={imgRef}
        referrerPolicy="no-referrer"
        src={url}
      />
    </span>
  );
}

/**
 * A logo in the tile Connectors draws app logos in; `small` fits it beside a
 * dialog title. The name always sits beside it, so the tile is decorative.
 */
export function AppLogoTile({
  name,
  small = false,
  url,
}: {
  name: string;
  small?: boolean;
  url?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-lg bg-card text-foreground shadow-outline ${small ? "size-7" : "size-10"}`}
    >
      <AppLogo name={name} size={small ? "profile" : "md"} url={url} />
    </span>
  );
}
