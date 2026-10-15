import lockupUrl from '../../../../../design/brand/wordmark/foxbox-voice-lockup.svg?url'

/** The FoxBox Voice lockup, foxbox + VOICE · BETA (design/brand/wordmark/foxbox-voice-lockup.svg); size it with CSS. */
export function Lockup({ className }: { className?: string }) {
  return <img src={lockupUrl} className={className} alt="FoxBox Voice beta" draggable={false} />
}
