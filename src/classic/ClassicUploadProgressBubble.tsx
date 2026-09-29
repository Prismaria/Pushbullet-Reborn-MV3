export type ClassicUploadProgress = {
  fileName: string
  progress: number
}

export function ClassicUploadProgressBubble({ upload }: { upload: ClassicUploadProgress }) {
  const progress = Math.max(0, Math.min(90, Math.round(upload.progress)))
  return (
    <div className="chat-row outgoing queued classic-upload-progress">
      <div className="chat-bubble">
        <div className="chat-bubble-contents">
          <div className="chat-title">{upload.fileName}</div>
          <div className="chat-progress-bar" role="progressbar" aria-label={`Uploading ${upload.fileName}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <div className="chat-progress-bar-fill" style={{ width: `${progress}%` }} />
          </div>
          <div className="chat-date">Uploading…</div>
        </div>
      </div>
    </div>
  )
}
