'use client'

import * as React from 'react'

interface StarLayerProps {
  readonly count?: number
  readonly size?: number
  readonly duration?: number
  readonly starColor?: string
  readonly className?: string
}

function generateStars(count: number, starColor: string): string {
  const shadows: string[] = []
  for (let i = 0; i < count; i++) {
    const x = Math.floor(Math.random() * 4000) - 2000
    const y = Math.floor(Math.random() * 4000) - 2000
    shadows.push(`${x}px ${y}px ${starColor}`)
  }
  return shadows.join(', ')
}

function StarLayer({
  count = 1000,
  size = 1,
  duration = 50,
  starColor = 'rgba(255, 255, 255, 0.7)',
}: StarLayerProps) {
  const [boxShadow, setBoxShadow] = React.useState<string>('')

  React.useEffect(() => {
    setBoxShadow(generateStars(count, starColor))
  }, [count, starColor])

  if (!boxShadow) return null

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '2000px',
        animation: `stars-scroll-up ${duration}s linear infinite`,
        willChange: 'transform',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          width: `${size}px`,
          height: `${size}px`,
          borderRadius: '50%',
          background: 'transparent',
          boxShadow,
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: '2000px',
          width: `${size}px`,
          height: `${size}px`,
          borderRadius: '50%',
          background: 'transparent',
          boxShadow,
        }}
      />
    </div>
  )
}

interface StarsBackgroundProps extends React.ComponentProps<'div'> {
  readonly factor?: number
  readonly speed?: number
  readonly starColor?: string
}

/**
 * StarsBackground — Ultra-dark void black background (#000000) with interactive mouse parallax
 * and scrolling star layers (sizes 1px, 2px, 3px).
 *
 * Darkened gradient: radial-gradient(ellipse at bottom, #0a0a0e 0%, #000000 100%)
 */
export function StarsBackground({
  children,
  className,
  factor = 0.05,
  speed = 50,
  starColor = 'rgba(255, 255, 255, 0.75)',
  ...props
}: StarsBackgroundProps) {
  const [offset, setOffset] = React.useState({ x: 0, y: 0 })

  const handleMouseMove = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
      const centerX = window.innerWidth / 2
      const centerY = window.innerHeight / 2
      const newOffsetX = -(e.clientX - centerX) * factor
      const newOffsetY = -(e.clientY - centerY) * factor
      setOffset({ x: newOffsetX, y: newOffsetY })
    },
    [factor],
  )

  return (
    <div
      data-slot="stars-background"
      onMouseMove={handleMouseMove}
      className={className}
      style={{
        position: 'relative',
        width: '100%',
        minHeight: '100vh',
        overflow: 'hidden',
        background: 'radial-gradient(ellipse at bottom, #09090d 0%, #000000 100%)',
        ...props.style,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `translate3d(${offset.x}px, ${offset.y}px, 0)`,
          transition: 'transform 300ms cubic-bezier(0.16, 1, 0.3, 1)',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      >
        <StarLayer
          count={1000}
          size={1}
          duration={speed}
          starColor={starColor}
        />
        <StarLayer
          count={400}
          size={2}
          duration={speed * 2}
          starColor="rgba(0, 240, 255, 0.65)"
        />
        <StarLayer
          count={200}
          size={3}
          duration={speed * 3}
          starColor="rgba(255, 184, 0, 0.65)"
        />
      </div>

      <div style={{ position: 'relative', zIndex: 1, width: '100%' }}>
        {children}
      </div>
    </div>
  )
}
