import { useState } from "react";

import { translate } from "@/i18n/language";
import { useT } from "@/i18n/use-translation";

import { AudioPreviewPlayer } from "./audio-preview-player";
import { filePreviewMessages as m } from "./file-preview.messages";
import { PreviewAdapterError } from "./preview-adapter-error";

export interface MediaPreviewAdapterProps {
  filename: string;
  mediaType: string;
  objectUrl: string;
  onError?: (message: string) => void;
  sourceSizeBytes?: number;
}

export function MediaPreviewAdapter({
  filename,
  mediaType,
  objectUrl,
  onError,
  sourceSizeBytes,
}: MediaPreviewAdapterProps) {
  const t = useT();
  const audio = mediaType.toLowerCase().startsWith("audio/");
  const [error, setError] = useState<string>();

  if (error) {
    return (
      <PreviewAdapterError
        message={error}
        onDownload={() => downloadMediaUrl(objectUrl, filename)}
      />
    );
  }

  const handleError = () => {
    const message = translate(m.mediaCodecUnsupported);
    setError(message);
    onError?.(message);
  };

  return (
    <section
      aria-label={t(audio ? m.audioPreview : m.videoPreview, {
        name: filename,
      })}
      className={`flex h-full min-h-[420px] items-center justify-center p-5 ${audio ? "bg-app-surface" : "bg-app-surface-soft"}`}
    >
      {audio ? (
        <AudioPreviewPlayer
          filename={filename}
          mediaType={mediaType}
          objectUrl={objectUrl}
          onError={handleError}
          sourceSizeBytes={sourceSizeBytes}
        />
      ) : (
        // eslint-disable-next-line jsx-a11y/media-has-caption -- user-provided media has no caption track to reference
        <video
          className="aspect-video w-full max-w-5xl rounded-md bg-black shadow-sm"
          controls
          onError={handleError}
          playsInline
          preload="auto"
          title={filename}
        >
          <source src={objectUrl} type={mediaType} />
        </video>
      )}
    </section>
  );
}

function downloadMediaUrl(url: string, filename: string) {
  const anchor = document.createElement("a");
  anchor.download = filename;
  anchor.href = url;
  anchor.click();
}
