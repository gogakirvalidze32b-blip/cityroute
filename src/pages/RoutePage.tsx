import { useMemo, useState } from 'react'

import { Link, Navigate, useParams } from 'react-router-dom'

import { ExamDriveSession } from '@/components/ExamDriveSession'

import { useAuth } from '@/context/AuthContext'

import { useRoutes } from '@/hooks/useRoutes'



type NavPhase = 'preview' | 'active' | 'summary'



export function RoutePage() {

  const { slug } = useParams<{ slug: string }>()

  const { hasAccess, deviceBlocked } = useAuth()

  const { routes } = useRoutes()

  const [navPhase, setNavPhase] = useState<NavPhase>('preview')



  const route = useMemo(() => routes.find((r) => r.slug === slug), [routes, slug])



  if (deviceBlocked || !hasAccess) return <Navigate to="/" replace />

  if (!route) {

    return (

      <div className="page center">

        <p>მარშრუტი ვერ მოიძებნა</p>

        <Link to="/">უკან</Link>

      </div>

    )

  }



  return (

    <div

      className={`route-page route-page--exam${navPhase === 'active' ? ' route-page--driving' : ''}${navPhase === 'summary' ? ' route-page--summary' : ''}`}

    >

      {navPhase === 'preview' && (

        <div className="route-toolbar">

          <Link to="/" className="ghost">

            ← მარშრუტები

          </Link>

          <div className="toolbar-title">
            <strong>{route.name_ka}</strong>
            {route.license_category && (
              <span className="tag tag--category">
                {route.license_category === 'B' && '🚗 B'}
                {route.license_category === 'C' && '🚛 C'}
                {route.license_category === 'C,D' && '🚛🚌 C+D'}
              </span>
            )}
            {route.official_label && <span className="tag">{route.official_label}</span>}
          </div>

          <span className="tag tag--exam">გამოცდა</span>

        </div>

      )}

      <ExamDriveSession route={route} onPhaseChange={setNavPhase} />

    </div>

  )

}


