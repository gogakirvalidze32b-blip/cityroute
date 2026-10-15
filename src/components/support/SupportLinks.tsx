import { Link } from 'react-router-dom'
import { SUPPORT_EMAIL } from '@/lib/support/constants'
import { S } from '@/lib/support/strings'
import { useAuth } from '@/context/AuthContext'
import { useSupportUnread } from '@/lib/support/useSupportUnread'
import '@/styles/support.css'

/** Profile / home-screen button that opens the support chat. Shows a badge
 *  with the number of unread replies. */
export function SupportButton() {
  const { user } = useAuth()
  const unread = useSupportUnread(user?.id)
  return (
    <Link to="/support" className="support-button">
      <span>{S.buttonLabel}</span>
      {unread > 0 && (
        <span className="support-button__badge" aria-label={`${unread}`}>
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </Link>
  )
}

/** Footer line: "დახმარება" link + contact e-mail.
 *  The chat route itself explains the login requirement to signed-out users,
 *  so the same link works for everybody. */
export function SupportFooterLinks() {
  return (
    <p className="support-footer">
      <Link to="/support">{S.footerHelp}</Link>
      <span aria-hidden="true"> · </span>
      <span>{S.footerContact} </span>
      <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
    </p>
  )
}
