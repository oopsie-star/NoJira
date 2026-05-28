import type { Profile } from '@/types'

function getInitials(name: string) {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

interface UserAvatarProps {
  profile?: Pick<Profile, 'full_name' | 'email' | 'avatar_url'> | null
  size?: number
  muted?: boolean
}

export function UserAvatar({ profile, size = 28, muted = false }: UserAvatarProps) {
  const label = profile?.full_name || profile?.email || '?'

  if (profile?.avatar_url) {
    return (
      <img
        src={profile.avatar_url}
        alt={label}
        style={{ width: size, height: size }}
        className="rounded-full border border-white/20 object-cover"
      />
    )
  }

  return (
    <span
      style={{ width: size, height: size, fontSize: Math.max(11, size * 0.38) }}
      className={`inline-flex items-center justify-center rounded-full font-semibold text-white ${
        muted ? 'bg-slate-400' : 'bg-jira-blue'
      }`}
    >
      {getInitials(label)}
    </span>
  )
}
