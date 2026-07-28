'use client'

import React, { useId, useState } from 'react'

/**
 * Interactive 3D Planetary Globe with rotating orbital rings and neon cyan atmosphere.
 * Designed for Pure Void Black (#000000) backgrounds with zero dark blue.
 */
export function AstroGlobe3D() {
  const glowId = useId()
  const [rotation, setRotation] = useState({ x: 15, y: -25 })

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width - 0.5
    const y = (e.clientY - rect.top) / rect.height - 0.5
    setRotation({
      x: 15 - y * 30,
      y: -25 + x * 40,
    })
  }

  return (
    <div
      onMouseMove={handleMouseMove}
      style={{
        width: '100%',
        height: '180px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        perspective: '800px',
        cursor: 'pointer',
        overflow: 'hidden',
        background: 'transparent',
      }}
      aria-label="3D Financial Sphere Visualization"
    >
      <div
        style={{
          position: 'relative',
          width: '140px',
          height: '140px',
          transformStyle: 'preserve-3d',
          transform: `rotateX(${rotation.x}deg) rotateY(${rotation.y}deg)`,
          transition: 'transform 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Planet Core Sphere */}
        <div
          style={{
            position: 'absolute',
            inset: '20px',
            borderRadius: '50%',
            background: 'radial-gradient(circle at 35% 30%, #00f0ff 0%, #0a0a0a 70%, #000000 100%)',
            boxShadow: '0 0 35px rgba(0, 240, 255, 0.4), inset 0 0 20px rgba(0, 240, 255, 0.3)',
            border: '1px solid rgba(0, 240, 255, 0.4)',
          }}
        />

        {/* 3D Tilted Orbital Ring 1 */}
        <div
          style={{
            position: 'absolute',
            inset: '-10px',
            borderRadius: '50%',
            border: '1.5px solid rgba(0, 240, 255, 0.4)',
            borderTopColor: 'transparent',
            transform: 'rotateX(75deg) rotateY(15deg)',
            boxShadow: '0 0 15px rgba(0, 240, 255, 0.2)',
          }}
        />

        {/* 3D Tilted Orbital Ring 2 */}
        <div
          style={{
            position: 'absolute',
            inset: '-22px',
            borderRadius: '50%',
            border: '1px dashed rgba(255, 184, 0, 0.35)',
            transform: 'rotateX(70deg) rotateY(-35deg)',
          }}
        />

        {/* Orbiting Satellite Node */}
        <div
          style={{
            position: 'absolute',
            top: '0px',
            left: '60px',
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: '#ffb800',
            boxShadow: '0 0 12px #ffb800',
          }}
        />
      </div>
    </div>
  )
}
